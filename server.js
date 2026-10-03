import express from "express";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { Encoder, Profile } from "@garmin/fitsdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function calcCalories(weightKg, distanceMeters, durationSeconds) {
  // 跑步 ACSM 代谢公式：VO2 = 0.2*速度(m/min) + 3.5，单位 ml/kg/min
  // 热量 = VO2 * 体重(kg) * 时长(min) / 1000(转L) * 5(kcal/L O2)
  const speedMPerMin = (distanceMeters / durationSeconds) * 60;
  const vo2 = 0.2 * speedMPerMin + 3.5;
  const minutes = durationSeconds / 60;
  return Math.round((vo2 * weightKg * minutes / 1000) * 5);
}

const MAX_POINTS = 20000;
const MAX_EXPANDED_POINTS = 100000; // 轨迹点数 × 圈数 的展开上限
const MAX_LAPS = 500;
const MAX_DURATION_SEC = 24 * 60 * 60; // 单次活动时长上限：24 小时

function parseParams(body) {
  const {
    startTime, points, paceSecondsPerKm,
    hrRest, hrMax, lapCount, weightKg, isClosed
  } = body || {};

  const weightNum = Number(weightKg);
  const weight =
    Number.isFinite(weightNum) && weightNum >= 30 && weightNum <= 150
      ? weightNum : 65;

  if (!startTime || !points || !Array.isArray(points) || points.length < 2) {
    return { error: "缺少参数：需要 startTime、至少两个轨迹点 points" };
  }
  if (points.length > MAX_POINTS) {
    return { error: `轨迹点数过多（上限 ${MAX_POINTS} 个）` };
  }
  for (const p of points) {
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      return { error: "轨迹点包含无效的经纬度坐标" };
    }
  }

  const startDate = new Date(startTime);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "startTime 格式不正确" };
  }

  const pace = Number(paceSecondsPerKm);
  if (!Number.isFinite(pace) || pace < 90 || pace > 1800) {
    return { error: "配速无效：需在 1'30\" ~ 30'00\" /km 之间" };
  }

  const hrRestVal = Number(hrRest);
  const hrMaxVal = Number(hrMax);
  if (
    !Number.isFinite(hrRestVal) || !Number.isFinite(hrMaxVal) ||
    hrRestVal < 20 || hrMaxVal > 250 || hrRestVal >= hrMaxVal
  ) {
    return { error: "心率参数无效：需满足 20 ≤ 静息心率 < 最大心率 ≤ 250" };
  }

  const lapsRaw = Number(lapCount);
  const laps = Number.isFinite(lapsRaw) && lapsRaw > 0 ? lapsRaw : 1;
  if (laps > MAX_LAPS) {
    return { error: `圈数过多（上限 ${MAX_LAPS} 圈）` };
  }
  if (points.length * (Math.floor(laps) + 1) > MAX_EXPANDED_POINTS) {
    return { error: "轨迹点数 × 圈数过多，请减少圈数或降低平滑度" };
  }
  const closed = Boolean(isClosed);

  return { startDate, points, pace, hrRestVal, hrMaxVal, laps, weight, isClosed: closed };
}

// 校验预估总时长（公里数 × 配速），超限返回错误信息
function checkDurationLimit(totalDistMeters, paceSecondsPerKm) {
  const estimatedSec = (totalDistMeters / 1000) * paceSecondsPerKm;
  if (estimatedSec > MAX_DURATION_SEC) {
    return "轨迹总时长超过 24 小时上限，请减少圈数或缩短路线";
  }
  return null;
}

function toSemicircles(deg) {
  return Math.round((deg * 2147483648) / 180);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function offsetPointMeters(point, offsetLatMeters, offsetLonMeters) {
  const metersPerDegLat = 111320;
  const metersPerDegLon =
    111320 * Math.cos((point.lat * Math.PI) / 180);
  return {
    lat: point.lat + offsetLatMeters / metersPerDegLat,
    lng: point.lng + offsetLonMeters / metersPerDegLon
  };
}

function buildClosedBasePoints(points) {
  if (!points || points.length < 2) return points || [];
  const first = points[0];
  const last = points[points.length - 1];
  const d = haversineDistance(first.lat, first.lng, last.lat, last.lng);
  if (d < 5) {
    return points;
  }
  const closed = points.slice();
  closed.push({ lat: first.lat, lng: first.lng });
  return closed;
}

function computeDistances(allPoints) {
  const distances = [0];
  let totalDist = 0;
  for (let i = 1; i < allPoints.length; i++) {
    const d = haversineDistance(
      allPoints[i - 1].lat, allPoints[i - 1].lng,
      allPoints[i].lat, allPoints[i].lng
    );
    totalDist += d;
    distances.push(totalDist);
  }
  return { distances, totalDist };
}

function buildTrack(basePoints, usedLaps, addNoise, isClosed = false) {
  // 仅在多圈或用户明确指定闭合环线时，才将首尾相连形成封闭回路；单圈开环跑保持原样
  const effectiveBase = (usedLaps > 1 || isClosed)
    ? buildClosedBasePoints(basePoints)
    : basePoints;

  const { distances, totalDist } = computeDistances(effectiveBase);
  if (totalDist === 0) return effectiveBase;

  const fullLaps = Math.floor(usedLaps);
  const remainderRatio = usedLaps - fullLaps;
  const allPoints = [];

  for (let lapIndex = 0; lapIndex < fullLaps; lapIndex++) {
    let offsetLatMeters = 0, offsetLonMeters = 0;
    if (addNoise && usedLaps > 1) {
      const radiusMeters = 0.3 + Math.random() * 1.2;
      const angle = Math.random() * Math.PI * 2;
      offsetLatMeters = radiusMeters * Math.cos(angle);
      offsetLonMeters = radiusMeters * Math.sin(angle);
    }
    for (let i = 0; i < effectiveBase.length; i++) {
      if (lapIndex > 0 && i === 0 && allPoints.length > 0) continue;
      const p = effectiveBase[i];
      if (addNoise && usedLaps > 1) {
        allPoints.push(offsetPointMeters(p, offsetLatMeters, offsetLonMeters));
      } else {
        allPoints.push(p);
      }
    }
  }

  // 小数圈数支持（如 2.5 圈）
  if (remainderRatio > 0.001) {
    const targetFractionDist = totalDist * remainderRatio;
    let offsetLatMeters = 0, offsetLonMeters = 0;
    if (addNoise && usedLaps > 1) {
      const radiusMeters = 0.3 + Math.random() * 1.2;
      const angle = Math.random() * Math.PI * 2;
      offsetLatMeters = radiusMeters * Math.cos(angle);
      offsetLonMeters = radiusMeters * Math.sin(angle);
    }
    for (let i = 0; i < effectiveBase.length; i++) {
      if (fullLaps > 0 && i === 0 && allPoints.length > 0) continue;
      if (distances[i] <= targetFractionDist) {
        const p = effectiveBase[i];
        allPoints.push(addNoise ? offsetPointMeters(p, offsetLatMeters, offsetLonMeters) : p);
      } else {
        const prevDist = distances[i - 1];
        const nextDist = distances[i];
        const span = nextDist - prevDist;
        const ratio = span > 0 ? (targetFractionDist - prevDist) / span : 0;
        const p0 = effectiveBase[i - 1];
        const p1 = effectiveBase[i];
        const finalP = {
          lat: p0.lat + ratio * (p1.lat - p0.lat),
          lng: p0.lng + ratio * (p1.lng - p0.lng)
        };
        allPoints.push(addNoise ? offsetPointMeters(finalP, offsetLatMeters, offsetLonMeters) : finalP);
        break;
      }
    }
  }

  return allPoints;
}

// 辅助：沿折线按累计距离进行精准位置插值
function interpolatePositionAlongPath(allPoints, distances, distMeters) {
  const n = allPoints.length;
  if (distMeters <= 0) return { lat: allPoints[0].lat, lng: allPoints[0].lng };
  if (distMeters >= distances[n - 1]) return { lat: allPoints[n - 1].lat, lng: allPoints[n - 1].lng };

  let lo = 0, hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] < distMeters) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const idx = Math.max(1, lo);
  const d0 = distances[idx - 1];
  const d1 = distances[idx];
  const span = d1 - d0;
  const ratio = span > 0 ? (distMeters - d0) / span : 0;
  const p0 = allPoints[idx - 1];
  const p1 = allPoints[idx];

  return {
    lat: p0.lat + ratio * (p1.lat - p0.lat),
    lng: p0.lng + ratio * (p1.lng - p0.lng)
  };
}

// ===== 1Hz 秒级拟真采样计算核心 =====
function compute1HzSamples(allPoints, totalDist, paceSecondsPerKm, hrRestVal, hrMaxVal, weightKg) {
  const totalDistanceKm = totalDist / 1000;
  const targetDurationSec = Math.max(2, Math.round(totalDistanceKm * paceSecondsPerKm));
  const avgSpeedTarget = totalDist / targetDurationSec;

  const { distances } = computeDistances(allPoints);

  // 1. 生成每一秒的速度权重，带长周期体力起伏与微波动
  const phase1 = Math.random() * Math.PI * 2;
  const phase2 = Math.random() * Math.PI * 2;
  const rawSpeeds = new Float64Array(targetDurationSec);
  let speedSum = 0;

  for (let t = 0; t < targetDurationSec; t++) {
    const frac = t / targetDurationSec;
    // 热身阶段稍慢（前 60s 从 88% 升到 100%），中途微波动 ±3%
    let warmupFactor = 1.0;
    if (t < 60) {
      warmupFactor = 0.88 + 0.12 * (t / 60);
    }
    const longWave = 0.03 * Math.sin(frac * Math.PI * 2 + phase1);
    const shortWave = 0.015 * Math.sin(frac * Math.PI * 8 + phase2);
    const microNoise = (Math.random() - 0.5) * 0.02;

    const s = avgSpeedTarget * warmupFactor * (1 + longWave + shortWave + microNoise);
    rawSpeeds[t] = Math.max(0.5, s);
    speedSum += rawSpeeds[t];
  }

  // 归一化缩放，确保累计距离精确等于 totalDist
  const speedScale = totalDist / speedSum;
  for (let t = 0; t < targetDurationSec; t++) {
    rawSpeeds[t] *= speedScale;
  }

  // 2. 逐秒采样点位与高阶运动学指标
  const samples = [];
  let cumDist = 0;
  let currentHr = hrRestVal + 15; // 刚开跑初始心率
  const baseAlt = 16.5 + Math.random() * 5.0; // 真实基准海拔（米）
  const altPhase = Math.random() * Math.PI * 2;

  // GPS 滤波漂移状态（平滑随机游走，避免每秒剧烈突跳）
  let jitterLatMeters = 0;
  let jitterLngMeters = 0;

  for (let t = 0; t < targetDurationSec; t++) {
    const speed = rawSpeeds[t];
    cumDist += speed;
    if (cumDist > totalDist) cumDist = totalDist;

    // 沿轨迹精准插值出几何坐标
    const pos = interpolatePositionAlongPath(allPoints, distances, cumDist);

    // 叠加微弱的自然 GPS 漂移（±0.6米平滑游走）
    jitterLatMeters = jitterLatMeters * 0.88 + (Math.random() - 0.5) * 0.25;
    jitterLngMeters = jitterLngMeters * 0.88 + (Math.random() - 0.5) * 0.25;
    const jitteredPos = offsetPointMeters(pos, jitterLatMeters, jitterLngMeters);

    // 真实心率计算：前 90 秒从静息平滑爬升到有氧耐力心率区
    const frac = t / targetDurationSec;
    const intensity = Math.min(1.0, Math.max(0.3, speed / (avgSpeedTarget || 1)));
    let hrTarget = hrRestVal + (hrMaxVal - hrRestVal) * (0.62 + 0.18 * intensity);
    if (t < 90) {
      const warmupProgress = t / 90;
      hrTarget = (hrRestVal + 20) + (hrTarget - (hrRestVal + 20)) * warmupProgress;
    }
    currentHr += (hrTarget - currentHr) * 0.08;
    const hrJitter = (Math.random() - 0.5) * 1.5;
    const heartRate = Math.round(Math.min(hrMaxVal, Math.max(hrRestVal, currentHr + hrJitter)));

    // 步频 SPM：根据速度动态正相关，通常在 160 ~ 185 spm
    const baseCadence = 168 + (speed - 2.8) * 6.5;
    const cadenceNoise = (Math.random() - 0.5) * 3;
    const cadenceSpm = Math.round(Math.max(148, Math.min(196, baseCadence + cadenceNoise)));
    const cadenceRpm = Math.round(cadenceSpm / 2); // FIT 标准 RPM

    // 步长 stepLength：按速度与步频推导，单位毫米 mm（通常 750mm ~ 1150mm）
    const stepLengthMeters = speed / (cadenceSpm / 60);
    const stepLengthMm = Math.round(Math.max(550, Math.min(1300, stepLengthMeters * 1000)));

    // 触地时间 stanceTime：210ms ~ 280ms
    const stanceTimeMs = Math.round(Math.max(190, Math.min(290, 275 - speed * 18 + (Math.random() - 0.5) * 6)));

    // 垂直振幅 verticalOscillation：70mm ~ 95mm
    const vertOscMm = Math.round(Math.max(60, Math.min(105, 75 + speed * 3.2 + (Math.random() - 0.5) * 4)));

    // 跑步功率 power (W)
    const powerW = Math.round(Math.max(100, Math.min(450, speed * weightKg * 1.05 + (cadenceSpm - 170) * 0.3)));

    // 平缓微起伏海拔（米）
    const altitudeMeters = Number((baseAlt + 1.2 * Math.sin(frac * Math.PI * 3 + altPhase) + (Math.random() - 0.5) * 0.15).toFixed(1));

    samples.push({
      timeSec: t,
      distance: Number(cumDist.toFixed(1)),
      speed: Number(speed.toFixed(3)),
      heartRate,
      cadenceSpm,
      cadenceRpm,
      stepLength: stepLengthMm,
      stanceTime: stanceTimeMs,
      verticalOscillation: vertOscMm,
      power: powerW,
      altitude: altitudeMeters,
      lat: jitteredPos.lat,
      lng: jitteredPos.lng
    });
  }

  return { samples, totalDurationSec: targetDurationSec };
}

app.post("/api/preview", (req, res) => {
  try {
    const params = parseParams(req.body);
    if (params.error) return res.status(400).json({ error: params.error });

    const { startDate, points, pace, hrRestVal, hrMaxVal, laps, weight, isClosed } = params;

    const allPoints = buildTrack(points, laps, false, isClosed);
    const { totalDist } = computeDistances(allPoints);

    if (totalDist === 0) {
      return res.status(400).json({ error: "轨迹距离为 0，请绘制更长的路线" });
    }

    const durationError = checkDurationLimit(totalDist, pace);
    if (durationError) return res.status(400).json({ error: durationError });

    const { samples, totalDurationSec } = compute1HzSamples(
      allPoints, totalDist, pace, hrRestVal, hrMaxVal, weight
    );

    const calories = calcCalories(weight, totalDist, totalDurationSec);

    // 针对前端图表做轻量抽样（最多返回 600 个点给图表，极大提升渲染速度与流畅度）
    const stride = Math.max(1, Math.floor(samples.length / 600));
    const previewSamples = [];
    for (let i = 0; i < samples.length; i += stride) {
      previewSamples.push({
        ...samples[i],
        cadence: samples[i].cadenceSpm
      });
    }
    if (previewSamples[previewSamples.length - 1] !== samples[samples.length - 1]) {
      previewSamples.push({
        ...samples[samples.length - 1],
        cadence: samples[samples.length - 1].cadenceSpm
      });
    }

    return res.json({
      totalDistanceMeters: totalDist,
      totalDurationSec,
      samples: previewSamples,
      calories
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "生成预览失败" });
  }
});

app.post("/api/generate-fit", (req, res) => {
  try {
    const variantRaw = Number(req.body?.variantIndex);
    const variant = Number.isFinite(variantRaw) && variantRaw > 0 ? Math.floor(variantRaw) : 1;

    const params = parseParams(req.body);
    if (params.error) return res.status(400).json({ error: params.error });

    const { startDate, points, pace, hrRestVal, hrMaxVal, laps, weight, isClosed } = params;

    const allPoints = buildTrack(points, laps, true, isClosed);
    const { totalDist } = computeDistances(allPoints);

    if (totalDist === 0) {
      return res.status(400).json({ error: "轨迹距离为 0，请绘制更长的路线" });
    }

    const durationError = checkDurationLimit(totalDist, pace);
    if (durationError) return res.status(400).json({ error: durationError });

    // 生成标准的 1Hz 逐秒采样数据
    const { samples, totalDurationSec } = compute1HzSamples(
      allPoints, totalDist, pace, hrRestVal, hrMaxVal, weight
    );

    const calories = calcCalories(weight, totalDist, totalDurationSec);

    // 汇总计算
    const cadenceRpmValues = samples.map(s => s.cadenceRpm);
    const avgCadenceRpm = Math.round(cadenceRpmValues.reduce((a, b) => a + b, 0) / cadenceRpmValues.length);

    const hrValues = samples.map(s => s.heartRate);
    const avgHr = Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
    const maxHr = Math.max(...hrValues);

    const powers = samples.map(s => s.power);
    const avgPower = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
    const maxPower = Math.max(...powers);

    const avgSpeed = totalDist / totalDurationSec;
    const sessionEnd = new Date(startDate.getTime() + totalDurationSec * 1000);

    const encoder = new Encoder();

    // 1. FILE_ID
    encoder.onMesg(Profile.MesgNum.FILE_ID, {
      manufacturer: "development",
      product: 1,
      timeCreated: sessionEnd,
      type: "activity"
    });

    // 2. DEVICE_INFO
    encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
      timestamp: startDate,
      manufacturer: "development",
      product: 1,
      serialNumber: 1
    });

    // 3. SESSION
    encoder.onMesg(Profile.MesgNum.SESSION, {
      timestamp: sessionEnd,
      startTime: startDate,
      totalElapsedTime: totalDurationSec,
      totalTimerTime: totalDurationSec,
      totalDistance: totalDist,
      totalCalories: calories,
      sport: "running",
      subSport: "generic",
      avgSpeed,
      avgHeartRate: avgHr,
      maxHeartRate: maxHr,
      avgCadence: avgCadenceRpm,
      avgPower,
      maxPower
    });

    // 4. LAP
    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: sessionEnd,
      startTime: startDate,
      totalElapsedTime: totalDurationSec,
      totalTimerTime: totalDurationSec,
      totalDistance: totalDist,
      totalCalories: calories,
      sport: "running",
      subSport: "generic",
      avgSpeed,
      avgHeartRate: avgHr,
      maxHeartRate: maxHr,
      avgCadence: avgCadenceRpm,
      avgPower
    });

    // 5. 1Hz 逐秒 RECORD 记录（全套跑步动态防作弊字段）
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const timestamp = new Date(startDate.getTime() + s.timeSec * 1000);

      encoder.onMesg(Profile.MesgNum.RECORD, {
        timestamp,
        positionLat: toSemicircles(s.lat),
        positionLong: toSemicircles(s.lng),
        distance: s.distance,
        altitude: s.altitude,
        speed: s.speed,
        heartRate: s.heartRate,
        cadence: s.cadenceRpm,
        power: s.power,
        stanceTime: s.stanceTime,
        verticalOscillation: s.verticalOscillation,
        stepLength: s.stepLength
      });
    }

    // 6. ACTIVITY
    encoder.onMesg(Profile.MesgNum.ACTIVITY, {
      timestamp: sessionEnd,
      totalTimerTime: totalDurationSec,
      numSessions: 1,
      type: "manual"
    });

    const uint8Array = encoder.close();
    const buffer = Buffer.from(uint8Array);

    res.setHeader("Content-Type", "application/vnd.ant.fit");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=run_${variant}.fit`
    );
    return res.send(buffer);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "生成 FIT 文件失败" });
  }
});

const parsedPort = Number(process.env.PORT);
const DEFAULT_PORT = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
// 仅监听本机回环地址，避免生成器暴露到局域网
const HOST = "127.0.0.1";

function startServer(port, maxTries = 10) {
  const server = app.listen(port, HOST, () => {
    const actualPort = server.address().port;
    console.log(`Server listening on http://localhost:${actualPort} (仅本机可访问)`);
    openBrowser(actualPort);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && maxTries > 0) {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1, maxTries - 1);
    } else {
      console.error("Server listen error:", err);
    }
  });
}

// 服务器就绪后用系统默认浏览器打开工具页（端口顺延时也能打开正确地址）。
// 设 FIT_TOOL_NO_BROWSER=1 可禁用（自动化测试用）。
function openBrowser(port) {
  if (process.platform !== "win32" || process.env.FIT_TOOL_NO_BROWSER === "1") return;
  exec(`start "" http://localhost:${port}`, (err) => {
    if (err) console.warn("自动打开浏览器失败，请手动访问上面打印的地址");
  });
}

startServer(DEFAULT_PORT);

