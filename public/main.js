  // 限制地图显示范围（本工具面向国内校园跑场景）
const chinaBounds = L.latLngBounds(
  L.latLng(3.86, 73.66),    // 西南角：南海
  L.latLng(53.55, 135.05)   // 东北角：黑龙江
);

const map = L.map("map", {
  maxBounds: chinaBounds,
  maxBoundsViscosity: 1.0,  // 1.0 = 硬边界，0.0 = 软边界
  zoomControl: false,       // 默认左上角会被悬浮面板遮挡，改为右上角
  attributionControl: true
}).setView([26.083719, 119.246678], 13);
L.control.zoom({ position: "topright" }).addTo(map);

// ===== 地图源注册表 =====
// 只收录无坐标偏移的图源（WGS-84 / CGCS2000）：
// 高德/腾讯等 GCJ-02 图源会让点下的坐标整体偏移数百米，不能用作轨迹绘制底图。
// 天地图 Token：优先用用户保存的自定义 Token（localStorage），否则用内置公共 Token
const TIANDITU_TK_DEFAULT = "502d67f7ee2b4e21acb3f506dc689d69";
const TIANDITU_TK_KEY = "fit_tianditu_tk";
let TIANDITU_TK = localStorage.getItem(TIANDITU_TK_KEY) || TIANDITU_TK_DEFAULT;
const TIANDITU_ATTR = "© 天地图 GS (2025) 1508号 - 甲测资字11110974 | 数据来源: 自然资源部 & NavInfo";
const TIANDITU_LOGO_PREFIX =
  '<div style="text-align: right; margin-bottom: 4px;">' +
  '<a href="https://www.tianditu.gov.cn" target="_blank" title="天地图tianditu.gov.cn" style="display: inline-block; line-height: 0;">' +
  '<img src="https://www.tianditu.gov.cn/assets/logo-Tuu47PEg.svg" alt="天地图" style="height: 60px;">' +
  '</a>' +
  '</div>';
const LEAFLET_PREFIX = '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>';

function tiandituLayer(code, maxNativeZoom) {
  return L.tileLayer(
    `https://t{s}.tianditu.gov.cn/${code}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${code}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TK}`,
    {
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
      minZoom: 5,
      maxZoom: 20,
      maxNativeZoom,
      attribution: TIANDITU_ATTR
    }
  );
}

const MAP_SOURCES = {
  tianditu_vec: {
    name: "天地图 · 矢量",
    tianditu: true,
    create: () => [tiandituLayer("vec", 18), tiandituLayer("cva", 17)]
  },
  tianditu_img: {
    name: "天地图 · 卫星影像",
    tianditu: true,
    create: () => [tiandituLayer("img", 18), tiandituLayer("cia", 18)]
  },
  tianditu_ter: {
    name: "天地图 · 地形",
    tianditu: true,
    create: () => [tiandituLayer("ter", 14), tiandituLayer("cta", 14)]
  },
  osm: {
    name: "OpenStreetMap",
    create: () => [
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      })
    ]
  },
  esri_sat: {
    name: "Esri · 世界影像",
    create: () => [
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 20,
          maxNativeZoom: 18,
          attribution: "Esri, Maxar, Earthstar Geographics"
        }
      )
    ]
  }
};

const MAP_SOURCE_KEY = "fit_map_source";
let currentBaseLayers = [];
let currentSourceId = null;

function switchMapSource(id, save = true) {
  const source = MAP_SOURCES[id];
  if (!source || id === currentSourceId) return;
  for (const layer of currentBaseLayers) {
    map.removeLayer(layer);
  }
  currentBaseLayers = source.create();
  for (const layer of currentBaseLayers) {
    layer.addTo(map);
  }
  currentSourceId = id;
  // 天地图系列按其服务条款显示 logo 版权，其余图源恢复 Leaflet 默认前缀
  map.attributionControl.setPrefix(source.tianditu ? TIANDITU_LOGO_PREFIX : LEAFLET_PREFIX);
  if (save) localStorage.setItem(MAP_SOURCE_KEY, id);
}

// 瓦片加载失败提示（节流：5 秒内只提示一次，避免刷屏）
let tileErrorNotified = false;
map.on("tileerror", () => {
  if (tileErrorNotified) return;
  tileErrorNotified = true;
  setTimeout(() => { tileErrorNotified = false; }, 5000);
  updateMessage("当前地图源部分瓦片加载失败（多为网络原因），可尝试切换其他地图源", true);
});

// 恢复上次使用的地图源（无记录时用天地图矢量）
{
  const savedSource = localStorage.getItem(MAP_SOURCE_KEY);
  switchMapSource(MAP_SOURCES[savedSource] ? savedSource : "tianditu_vec", false);
}

// 地图源下拉框联动
const mapSourceSelect = document.getElementById("mapSource");
if (mapSourceSelect) {
  mapSourceSelect.value = currentSourceId;
  mapSourceSelect.addEventListener("change", () => {
    switchMapSource(mapSourceSelect.value);
    updateMessage(`已切换地图源：${MAP_SOURCES[mapSourceSelect.value].name}`);
  });
}

// ===== 天地图 Token 自助管理 =====
// 保存到浏览器 localStorage：存一次，以后每次打开自动使用
{
  const tkInput = document.getElementById("tkInput");
  const saveBtn = document.getElementById("saveTkBtn");
  if (tkInput) tkInput.value = localStorage.getItem(TIANDITU_TK_KEY) || "";

  function applyTianToken() {
    const val = tkInput.value.trim();
    if (val) {
      localStorage.setItem(TIANDITU_TK_KEY, val);
      TIANDITU_TK = val;
    } else {
      localStorage.removeItem(TIANDITU_TK_KEY);
      TIANDITU_TK = TIANDITU_TK_DEFAULT;
    }
    // 若当前正用着天地图系图源，强制重建图层让新 Token 立即生效
    if (currentSourceId && currentSourceId.startsWith("tianditu")) {
      const keep = currentSourceId;
      currentSourceId = null;
      switchMapSource(keep, false);
    }
    if (val && !/^[0-9a-f]{32}$/i.test(val)) {
      updateMessage("Token 已保存，但格式不像天地图密钥（应为 32 位十六进制），请到官网核对", true);
    } else {
      updateMessage(val ? "天地图 Token 已保存并生效（保存在本机浏览器中）" : "已清除自定义 Token，恢复内置公共 Token");
    }
  }

  saveBtn?.addEventListener("click", applyTianToken);
  tkInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyTianToken();
  });
}
// 天地图 Token 管理END
// 地图源END

// 定位功能
let currentLocationMarker = null;
// 定位功能测试开关
const USE_TEST_LOCATION = false;  // true = 测试模式，false = 真实定位

const getLocationBtn = document.getElementById('getLocationBtn');
if (getLocationBtn) {
    getLocationBtn.addEventListener('click', () => {
        getLocationBtn.disabled = true;
        getLocationBtn.textContent = '定位中...';
        updateMessage('正在获取您的位置...');

        if (USE_TEST_LOCATION) {
            // 测试模式
            setTimeout(() => {
                const lat = 39.905130;
                const lng = 116.122225;
                const accuracy = 114514;

                if (currentLocationMarker) {
                    map.removeLayer(currentLocationMarker);
                }

                currentLocationMarker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'current-location-marker',
                        html: '<div class="location-pulse"></div>',
                        iconSize: [20, 20]
                    })
                }).addTo(map);

                currentLocationMarker.bindPopup(
                    `<b>当前位置（若想获取真实位置请退出测试模式）</b><br>` +
                    `纬度: ${lat.toFixed(6)}<br>` +
                    `经度: ${lng.toFixed(6)}<br>` +
                    `精度: ±${accuracy}米`
                ).openPopup();

                map.setView([lat, lng], 15);

                getLocationBtn.disabled = false;
                getLocationBtn.textContent = '尝试获取当前位置';
                updateMessage(`定位成功！精度约 ${accuracy} 米（测试模式）`);
            }, 500);
        } else {
            // 真实定位模式
            if (!navigator.geolocation) {
                updateMessage('您的浏览器不支持定位功能', true);
                getLocationBtn.disabled = false;
                getLocationBtn.textContent = '尝试获取当前位置';
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    const accuracy = position.coords.accuracy;

                    if (currentLocationMarker) {
                        map.removeLayer(currentLocationMarker);
                    }

                    currentLocationMarker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'current-location-marker',
                            html: '<div class="location-pulse"></div>',
                            iconSize: [20, 20]
                        })
                    }).addTo(map);

                    currentLocationMarker.bindPopup(
                        `<b>您的当前位置</b><br>` +
                        `纬度: ${lat.toFixed(6)}<br>` +
                        `经度: ${lng.toFixed(6)}<br>` +
                        `精度: ±${accuracy.toFixed(0)}米`
                    ).openPopup();

                    map.setView([lat, lng], 15);

                    getLocationBtn.disabled = false;
                    getLocationBtn.textContent = '尝试获取当前位置';
                    updateMessage(`定位成功！精度约 ${accuracy.toFixed(0)} 米`);
                },
                (error) => {
                    let errorMsg = '定位失败，请手动选择';

                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            errorMsg = '定位失败：您拒绝了位置权限请求';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMsg = '定位失败：位置信息不可用';
                            break;
                        case error.TIMEOUT:
                            errorMsg = '定位失败：请求超时';
                            break;
                    }

                    updateMessage(errorMsg, true);

                    getLocationBtn.disabled = false;
                    getLocationBtn.textContent = '尝试获取当前位置';
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        }
    });
}
// 定位功END

// 定位到坐标按钮
const goToCoordBtn = document.getElementById('goToCoordBtn');
if (goToCoordBtn) {
  goToCoordBtn.addEventListener('click', () => {
    const lat = parseFloat(document.getElementById('startLat')?.value);
    const lng = parseFloat(document.getElementById('startLng')?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      updateMessage('请输入有效的纬度和经度', true);
      return;
    }
    if (currentLocationMarker) {
      map.removeLayer(currentLocationMarker);
    }
    currentLocationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'current-location-marker',
        html: '<div class="location-pulse"></div>',
        iconSize: [20, 20]
      })
    }).addTo(map);
    currentLocationMarker.bindPopup(
      `<b>指定坐标</b><br>` +
      `纬度: ${lat.toFixed(6)}<br>` +
      `经度: ${lng.toFixed(6)}`
    ).openPopup();
    map.setView([lat, lng], 16);
    updateMessage(`已定位到坐标 (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
  });
}
// 定位到坐标按钮END

const weightInput = document.getElementById("weightInput");

const savedWeight = localStorage.getItem("fit_weight");

weightInput.value = savedWeight ? savedWeight : 65;

weightInput.addEventListener("change", () => {
  let v = parseFloat(weightInput.value);
  if (!Number.isFinite(v)) v = 65;
  v = Math.max(30, Math.min(150, v));
  weightInput.value = v;
  localStorage.setItem("fit_weight", v);
});

let routePoints = [];
let polyline = null;
let paceChart = null;
let hrChart = null;
let cadenceChart = null;
let previewData = null;
let previewTimer = null;
let previewIndex = 0;
let previewMarker = null;

function updateMessage(text, isError = false) {
  const el = document.getElementById("message");
  el.textContent = text || "";
  el.className = "message" + (isError ? " error" : "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟回收，避免个别浏览器在下载尚未开始时就吊销了地址
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function computeDistanceMeters(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat, points[i].lng
    );
  }
  return total;
}

// ===== 轨迹平滑（Catmull-Rom 样条）=====
function getSmoothness() {
  const val = parseInt(document.getElementById("smoothness")?.value, 10);
  return Number.isFinite(val) ? Math.max(0, val) : 0;
}

function setSmoothness(val) {
  const v = Math.max(0, Math.round(val));
  const slider = document.getElementById("smoothness");
  const num = document.getElementById("smoothnessNum");
  if (slider) slider.value = v;
  if (num) num.value = v;
}

function smoothPoints(points, smoothness) {
  if (!points || points.length < 3 || smoothness <= 0) return points || [];
  const n = points.length;
  let segmentsPerEdge = Math.max(1, Math.round(smoothness));
  // 限制总点数，避免超出服务器请求体上限（5MB）
  const maxTotalPoints = 5000;
  const maxSegments = Math.floor(maxTotalPoints / Math.max(1, n - 1));
  segmentsPerEdge = Math.min(segmentsPerEdge, Math.max(1, maxSegments));

  const result = [{ lat: points[0].lat, lng: points[0].lng }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    for (let j = 1; j <= segmentsPerEdge; j++) {
      const t = j / segmentsPerEdge;
      const t2 = t * t;
      const t3 = t2 * t;
      const lat = 0.5 * (
        (2 * p1.lat) +
        (-p0.lat + p2.lat) * t +
        (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
        (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
      );
      const lng = 0.5 * (
        (2 * p1.lng) +
        (-p0.lng + p2.lng) * t +
        (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 +
        (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3
      );
      result.push({ lat, lng });
    }
  }
  return result;
}

function getEffectivePoints() {
  return smoothPoints(routePoints, getSmoothness());
}

function redrawPolyline() {
  const effective = getEffectivePoints();
  if (effective.length > 0) {
    if (polyline) {
      polyline.setLatLngs(effective);
    } else {
      polyline = L.polyline(effective, { color: "#111111", weight: 3 }).addTo(map);
    }
  } else {
    if (polyline) {
      map.removeLayer(polyline);
      polyline = null;
    }
  }
}

function updateDistanceInfo() {
  const el = document.getElementById("distanceInfo");
  if (!el) return;
  const effective = getEffectivePoints();
  if (!effective || effective.length < 2) {
    el.textContent = "总距离约：0 公里";
    return;
  }
  const baseMeters = computeDistanceMeters(effective);
  const baseKm = baseMeters / 1000;
  const lapInput = document.getElementById("lapCount");
  const laps = Math.max(1, parseInt(lapInput?.value, 10) || 1);
  const totalKm = baseKm * laps;
  const baseStr = baseKm.toFixed(2);
  const totalStr = totalKm.toFixed(2);
  if (laps > 1) {
    el.textContent = `总距离约：${totalStr} 公里（基础：${baseStr} 公里 × ${laps} 圈）`;
  } else {
    el.textContent = `总距离约：${baseStr} 公里`;
  }
}

map.on("click", (e) => {
  routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  redrawPolyline();
  updateMessage(`已添加点数：${routePoints.length}`);
  updateDistanceInfo();
});

const undoBtn = document.getElementById("undoPoint");
undoBtn.addEventListener("click", () => {
  if (routePoints.length === 0) return;
  routePoints.pop();
  redrawPolyline();
  updateMessage(routePoints.length > 0 ? `已撤销，剩余 ${routePoints.length} 个点` : "轨迹已清空");
  updateDistanceInfo();
});

const clearBtn = document.getElementById("clearRoute");
clearBtn.addEventListener("click", () => {
  routePoints = [];
  redrawPolyline();
  updateMessage("轨迹已清除");
  updateDistanceInfo();
});

function dateToLocalInputValue(d) {
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

function randomPaceSeconds() {
  const fastMin = parseInt(document.getElementById("paceFastMin")?.value, 10);
  const fastSec = parseInt(document.getElementById("paceFastSec")?.value, 10);
  const slowMin = parseInt(document.getElementById("paceSlowMin")?.value, 10);
  const slowSec = parseInt(document.getElementById("paceSlowSec")?.value, 10);

  // 转换为总秒数/km（真实秒）
  const fastTotalSec = (Number.isFinite(fastMin) ? fastMin : 8) * 60 +
    (Number.isFinite(fastSec) ? fastSec : 0);
  const slowTotalSec = (Number.isFinite(slowMin) ? slowMin : 9) * 60 +
    (Number.isFinite(slowSec) ? slowSec : 36);

  const lo = Math.min(fastTotalSec, slowTotalSec);
  const hi = Math.max(fastTotalSec, slowTotalSec);
  return lo + Math.random() * (hi - lo);
}

function getRandomTimeInInterval(baseDate, dayOffset) {
  const minTimeVal = document.getElementById("startTimeMin")?.value || "06:00";
  const maxTimeVal = document.getElementById("startTimeMax")?.value || "08:00";

  const [minH, minM] = minTimeVal.split(":").map(Number);
  const [maxH, maxM] = maxTimeVal.split(":").map(Number);

  const lo = (Number.isFinite(minH) ? minH : 6) * 60 + (Number.isFinite(minM) ? minM : 0);
  const hi = (Number.isFinite(maxH) ? maxH : 8) * 60 + (Number.isFinite(maxM) ? maxM : 0);

  // 支持跨夜区间（如 22:00~02:00）：若 hi<lo，把上限延到次日再随机，最后回绕到一天内
  let spanLo = lo;
  let spanHi = hi;
  if (spanHi < spanLo) spanHi += 24 * 60;

  const randomTotalMin = spanLo + Math.random() * (spanHi - spanLo);
  const nextDay = randomTotalMin >= 24 * 60 ? 1 : 0;
  const dayMin = randomTotalMin % (24 * 60);
  const hour = Math.floor(dayMin / 60);
  const minute = Math.floor(dayMin % 60);
  const second = Math.floor(Math.random() * 60);

  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, second);
  d.setDate(d.getDate() + dayOffset + nextDay);
  return d;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function varyRoutePoints(points, variationPct, minKm, maxKm) {
  // 对基础轨迹做随机缩放，保持路线形状基本不变
  // 距离围绕基础值在 ±variationPct% 内波动，再用 minKm/maxKm 做绝对上下限
  const baseDist = computeDistanceMeters(points);
  const baseKm = baseDist / 1000;
  if (baseKm <= 0) return points.map(p => ({ lat: p.lat, lng: p.lng }));

  // 上下限一致性：上限低于下限时抬到下限（保下限优先），0 表示不限
  const loKm = minKm > 0 ? minKm : 0;
  const hiKm = maxKm > 0 ? maxKm : Infinity;

  // 在"随机幅度 ∩ 用户上下限"的交集内均匀随机，
  // 避免大量文件被钳制在同一边界值导致距离雷同
  const range = Math.max(0, variationPct) / 100;
  let lo = Math.max(loKm, baseKm * (1 - range));
  let hi = Math.min(hiKm, baseKm * (1 + range));
  if (hi < lo) {
    // 上下限与随机幅度冲突时，优先满足 km 上下限
    lo = loKm;
    hi = hiKm === Infinity ? baseKm * (1 + range) : hiKm;
    if (hi < lo) hi = lo * 1.05;
  }
  if (hi - lo < 0.01) hi = lo + 0.01; // 防退化：避免多份文件完全相同

  const targetKm = lo + Math.random() * (hi - lo);
  const targetDist = targetKm * 1000;
  const distScale = targetDist / baseDist;

  const origin = points[0];
  const result = points.map(p => ({
    lat: origin.lat + (p.lat - origin.lat) * distScale,
    lng: origin.lng + (p.lng - origin.lng) * distScale
  }));

  return result;
}

// 导出/预览共用的轨迹点获取：应用平滑，并在勾选"随机增减公里数"时做随机缩放
function getPointsForExport() {
  let points = getEffectivePoints();
  if (document.getElementById("randomDistance")?.checked) {
    const variation = parseFloat(document.getElementById("distanceVariation")?.value) || 5;
    const minKm = parseFloat(document.getElementById("minKm")?.value) || 0;
    const maxKm = parseFloat(document.getElementById("maxKm")?.value) || 0;
    points = varyRoutePoints(points, variation, minKm, maxKm);
  }
  return points;
}

function rebuildExportTimes() {
  const container = document.getElementById("exportTimes");
  const exportInput = document.getElementById("exportCount");
  if (!container || !exportInput) return;

  const count = Math.max(1, parseInt(exportInput.value, 10) || 1);
  const dateMode = document.getElementById("dateMode")?.value || "same-day";

  let baseDate = new Date();
  if (dateMode === "selected-date" || dateMode === "selected-consecutive") {
    const selectedDateVal = document.getElementById("selectedDate")?.value;
    if (selectedDateVal) {
      const parts = selectedDateVal.split("-");
      baseDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
  }

  container.innerHTML = "";

  const rows = [];
  for (let i = 0; i < count; i++) {
    const dayOffset =
      dateMode === "consecutive" || dateMode === "selected-consecutive" ? i : 0;
    rows.push({
      time: getRandomTimeInInterval(baseDate, dayOffset),
      paceSec: randomPaceSeconds()
    });
  }

  // 当天多份时按时间先后排序，并保证相邻两次跑步不重叠：
  // 间隔 = 上一次的预估时长（公里数 × 配速 × 圈数）+ 10 分钟休息
  if (dateMode === "same-day" || dateMode === "selected-date") {
    const lapInput = document.getElementById("lapCount");
    const laps = Math.max(1, parseInt(lapInput?.value, 10) || 1);
    const kmPerLap = computeDistanceMeters(getEffectivePoints()) / 1000;
    const restGapMs = 10 * 60 * 1000;
    const order = rows.map((_, i) => i).sort((a, b) => rows[a].time - rows[b].time);
    let prevEndMs = null;
    for (const idx of order) {
      const row = rows[idx];
      let t = row.time.getTime();
      const durationMs = kmPerLap * laps * row.paceSec * 1000;
      if (prevEndMs !== null && t < prevEndMs + restGapMs) {
        t = prevEndMs + restGapMs;
      }
      row.time = new Date(t);
      prevEndMs = t + durationMs;
    }
    // 展示顺序与时间顺序一致
    rows.sort((a, b) => a.time - b.time);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = document.createElement("div");
    row.className = "export-time-row";

    const label = document.createElement("span");
    label.textContent = `第 ${i + 1} 份`;

    const timeInput = document.createElement("input");
    timeInput.type = "datetime-local";
    timeInput.className = "export-time-input";
    timeInput.dataset.index = String(i);
    timeInput.value = dateToLocalInputValue(rows[i].time);

    let paceMinVal = Math.floor(rows[i].paceSec / 60);
    let paceSecVal = Math.round(rows[i].paceSec % 60);
    if (paceSecVal >= 60) {
      paceMinVal += 1;
      paceSecVal = 0;
    }

    const paceMinInput = document.createElement("input");
    paceMinInput.type = "number";
    paceMinInput.className = "export-pace-min";
    paceMinInput.min = "0";
    paceMinInput.step = "1";
    paceMinInput.value = String(paceMinVal);

    const dot = document.createElement("span");
    dot.textContent = ".";
    dot.style.cssText = "font-weight:700;color:#111;font-size:14px;margin:0 -2px;";

    const paceSecInput = document.createElement("input");
    paceSecInput.type = "number";
    paceSecInput.className = "export-pace-sec";
    paceSecInput.min = "0";
    paceSecInput.max = "59";
    paceSecInput.step = "1";
    paceSecInput.value = String(paceSecVal).padStart(2, "0");

    row.appendChild(label);
    row.appendChild(timeInput);
    row.appendChild(paceMinInput);
    row.appendChild(dot);
    row.appendChild(paceSecInput);
    container.appendChild(row);
  }
}

async function generateFit() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;
  if (hrRest >= hrMax) {
    updateMessage("静息心率需小于最大心率", true);
    return;
  }

  const lapInput = document.getElementById("lapCount");
  const exportInput = document.getElementById("exportCount");
  const lapCount = Math.max(1, parseInt(lapInput?.value, 10) || 1);
  const exportCount = Math.max(1, parseInt(exportInput?.value, 10) || 1);

  const shuffleChecked = document.getElementById("shuffleOrder")?.checked;
  let fileNumbers = Array.from({ length: exportCount }, (_, i) => i + 1);
  if (shuffleChecked) {
    fileNumbers = shuffleArray(fileNumbers);
  }

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (timeInputs.length < exportCount || paceMinInputs.length < exportCount || paceSecInputs.length < exportCount) {
    updateMessage("导出份数与时间/配速行数不一致", true);
    return;
  }

  try {
    const errors = [];
    let okCount = 0;
    const generatedFiles = [];
    for (let i = 0; i < exportCount; i++) {
      updateMessage(`正在生成第 ${i + 1}/${exportCount} 个 FIT 文件，请稍候...`);

      const input = timeInputs[i];
      if (!input || !input.value) {
        errors.push(`第 ${i + 1} 份缺少开始时间`);
        continue;
      }
      const fileStart = new Date(input.value);
      if (Number.isNaN(fileStart.getTime())) {
        errors.push(`第 ${i + 1} 份开始时间无效`);
        continue;
      }

      const paceMinInput = paceMinInputs[i];
      const paceSecInput = paceSecInputs[i];
      let filePaceSecondsPerKm = 360;
      if (paceMinInput && paceSecInput) {
        const pm = parseFloat(paceMinInput.value);
        const ps = parseFloat(paceSecInput.value);
        const sec = (Number.isFinite(pm) ? pm : 0) * 60 +
          (Number.isFinite(ps) ? ps : 0);
        if (!sec || sec <= 0) {
          errors.push(`第 ${i + 1} 份配速无效`);
          continue;
        }
        filePaceSecondsPerKm = sec;
      }

      const weightKg =
  Number(document.getElementById("weightInput").value) || 65;

      const pointsToSend = getPointsForExport();

      const res = await fetch("/api/generate-fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: fileStart.toISOString(),
          points: pointsToSend,
          paceSecondsPerKm: filePaceSecondsPerKm,
          hrRest,
          hrMax,
          lapCount,
          variantIndex: fileNumbers[i],
          weightKg
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errors.push(`第 ${i + 1} 份：${err.error || "生成失败"}`);
        continue;
      }

      const blob = await res.blob();
      const name = exportCount > 1 ? `runfit(${fileNumbers[i]}).fit` : "runfit.fit";
      if (exportCount > 1) {
        generatedFiles.push({ name, blob });
      } else {
        downloadBlob(blob, name);
      }
      okCount++;
    }

    // 多文件时打包成单个 ZIP 下载，避免浏览器拦截连续多次下载
    if (generatedFiles.length > 0) {
      if (typeof JSZip !== "undefined") {
        updateMessage("正在打包 ZIP，请稍候...");
        const zip = new JSZip();
        for (const f of generatedFiles) {
          zip.file(f.name, f.blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        downloadBlob(zipBlob, `runfit_${exportCount}份.zip`);
      } else {
        // JSZip 不可用时退回逐个下载（需间隔，绕过浏览器并发下载限制）
        for (const f of generatedFiles) {
          downloadBlob(f.blob, f.name);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    if (errors.length) {
      updateMessage(`已生成 ${okCount}/${exportCount} 个；失败：${errors.join("；")}`, okCount === 0);
    } else if (exportCount > 1) {
      updateMessage(`已生成 ${exportCount} 个 FIT 文件并打包为 ZIP 下载`);
    } else {
      updateMessage("已生成 FIT 文件并开始下载");
    }
  } catch (e) {
    console.error(e);
    updateMessage("请求失败，请稍后重试", true);
  }
}

const genBtn = document.getElementById("generateFit");
genBtn.addEventListener("click", generateFit);

const lapInputInit = document.getElementById("lapCount");
if (lapInputInit) {
  lapInputInit.addEventListener("input", updateDistanceInfo);
}
// 输入防抖：避免每敲一个键就重建整张时间/配速列表
const exportInputInit = document.getElementById("exportCount");
let exportCountDebounce = null;
if (exportInputInit) {
  exportInputInit.addEventListener("input", () => {
    clearTimeout(exportCountDebounce);
    exportCountDebounce = setTimeout(rebuildExportTimes, 400);
  });
}
const dateModeInit = document.getElementById("dateMode");
if (dateModeInit) {
  dateModeInit.addEventListener("change", () => {
    const mode = dateModeInit.value;
    const show = mode === "selected-date" || mode === "selected-consecutive" ? "" : "none";
    document.getElementById("selectedDateGroup").style.display = show;
    rebuildExportTimes();
  });
}

const rerollBtnInit = document.getElementById("rerollBtn");
if (rerollBtnInit) {
  rerollBtnInit.addEventListener("click", rebuildExportTimes);
}

// ===== 轨迹导出/导入（JSON）=====
function exportRoute() {
  if (routePoints.length < 2) {
    updateMessage("请先绘制至少两个轨迹点再导出", true);
    return;
  }
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    lapCount: parseInt(document.getElementById("lapCount")?.value, 10) || 1,
    smoothness: getSmoothness(),
    points: routePoints.map(p => ({ lat: p.lat, lng: p.lng }))
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  downloadBlob(blob, `route-${y}-${m}-${d}.json`);
  updateMessage(`已导出 ${routePoints.length} 个轨迹点`);
}

function importRoute(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !Array.isArray(data.points) || data.points.length < 2) {
        updateMessage("导入失败：文件格式无效（缺少 points 数组或点数不足）", true);
        return;
      }
      const validPoints = [];
      for (const p of data.points) {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          updateMessage("导入失败：存在无效的经纬度坐标", true);
          return;
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          updateMessage("导入失败：经纬度超出有效范围", true);
          return;
        }
        validPoints.push({ lat, lng });
      }
      routePoints = validPoints;
      redrawPolyline();
      updateDistanceInfo();
      if (routePoints.length > 0) {
        const bounds = L.latLngBounds(routePoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
      if (Number.isFinite(Number(data.lapCount))) {
        const lapInput = document.getElementById("lapCount");
        if (lapInput) lapInput.value = Math.max(1, Math.floor(Number(data.lapCount)));
      }
      if (Number.isFinite(Number(data.smoothness))) {
        setSmoothness(Number(data.smoothness));
        redrawPolyline();
        updateDistanceInfo();
      }
      updateMessage(`已导入 ${routePoints.length} 个轨迹点`);
    } catch (err) {
      updateMessage("导入失败：JSON 解析错误 - " + err.message, true);
    }
  };
  reader.onerror = () => {
    updateMessage("导入失败：文件读取错误", true);
  };
  reader.readAsText(file);
}

const exportRouteBtn = document.getElementById("exportRouteBtn");
if (exportRouteBtn) {
  exportRouteBtn.addEventListener("click", exportRoute);
}

const importRouteBtn = document.getElementById("importRouteBtn");
if (importRouteBtn) {
  importRouteBtn.addEventListener("click", () => {
    document.getElementById("importFileInput")?.click();
  });
}

const importFileInput = document.getElementById("importFileInput");
if (importFileInput) {
  importFileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importRoute(file);
      e.target.value = "";
    }
  });
}

// ===== 平滑度控件联动 =====
const smoothnessSlider = document.getElementById("smoothness");
const smoothnessNumInput = document.getElementById("smoothnessNum");
if (smoothnessSlider) {
  smoothnessSlider.addEventListener("input", () => {
    if (smoothnessNumInput) smoothnessNumInput.value = smoothnessSlider.value;
    redrawPolyline();
    updateDistanceInfo();
  });
}
if (smoothnessNumInput) {
  smoothnessNumInput.addEventListener("input", () => {
    let v = parseInt(smoothnessNumInput.value, 10);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(20, v));
    if (smoothnessSlider) smoothnessSlider.value = v;
    redrawPolyline();
    updateDistanceInfo();
  });
}

const randomDistInit = document.getElementById("randomDistance");
if (randomDistInit) {
  randomDistInit.addEventListener("change", () => {
    const show = randomDistInit.checked ? "" : "none";
    document.getElementById("distanceVariationGroup").style.display = show;
    document.getElementById("minKmGroup").style.display = show;
    document.getElementById("maxKmGroup").style.display = show;
  });
}
updateDistanceInfo();
// 初始化日期选择器默认值为今天
{
  const selectedDateInput = document.getElementById("selectedDate");
  if (selectedDateInput) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    selectedDateInput.value = `${y}-${m}-${dd}`;
  }
}
rebuildExportTimes();

function renderPreviewCharts(preview) {
  if (!preview || !Array.isArray(preview.samples) || preview.samples.length === 0) {
    updateMessage("预览数据为空", true);
    return;
  }

  const labels = preview.samples.map((s) => (s.timeSec / 60).toFixed(1));
  const paceData = preview.samples.map((s) => {
    const speed = s.speed > 0 ? s.speed : 0.01;
    const secPerKm = 1000 / speed;
    return secPerKm / 60;
  });
  const hrData = preview.samples.map((s) => s.heartRate);
  const cadenceData = preview.samples.map((s) => s.cadence || 0);

  const paceCtx = document.getElementById("paceChart").getContext("2d");
  const hrCtx = document.getElementById("hrChart").getContext("2d");
  const cadenceCtx = document.getElementById("cadenceChart").getContext("2d");

  if (paceChart) paceChart.destroy();
  if (hrChart) hrChart.destroy();
  if (cadenceChart) cadenceChart.destroy();

  paceChart = new Chart(paceCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "配速 (min/km)",
          data: paceData,
          borderColor: "#111111",
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: "时间 (分钟)" }
        },
        y: {
          title: { display: true, text: "min/km" },
          reverse: true
        }
      }
    }
  });

  hrChart = new Chart(hrCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "心率 (bpm)",
          data: hrData,
          borderColor: "#d30005",
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: "时间 (分钟)" }
        },
        y: {
          title: { display: true, text: "bpm" }
        }
      }
    }
  });

  cadenceChart = new Chart(cadenceCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "步频 (spm)",
          data: cadenceData,
          borderColor: "#707072",
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          title: { display: true, text: "时间 (分钟)" }
        },
        y: {
          title: { display: true, text: "spm" }
        }
      }
    }
  });
}

async function previewActivity() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (!timeInputs.length || !paceMinInputs.length || !paceSecInputs.length) {
    updateMessage("请先在导出列表中设置至少一份的时间和配速", true);
    return;
  }

  const firstTimeInput = timeInputs[0];
  if (!firstTimeInput.value) {
    const now = new Date();
    firstTimeInput.value = dateToLocalInputValue(now);
  }
  const start = new Date(firstTimeInput.value);
  if (Number.isNaN(start.getTime())) {
    updateMessage("预览使用的开始时间无效", true);
    return;
  }

  const firstPaceMinInput = paceMinInputs[0];
  const firstPaceSecInput = paceSecInputs[0];
  const pm = parseFloat(firstPaceMinInput.value);
  const ps = parseFloat(firstPaceSecInput.value);
  const paceSecondsPerKm = (Number.isFinite(pm) ? pm : 0) * 60 +
    (Number.isFinite(ps) ? ps : 0);
  if (!paceSecondsPerKm || paceSecondsPerKm <= 0) {
    updateMessage("预览使用的配速无效", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;
  if (hrRest >= hrMax) {
    updateMessage("静息心率需小于最大心率", true);
    return;
  }

  const lapInput = document.getElementById("lapCount");
  const lapCount = Math.max(1, parseInt(lapInput?.value, 10) || 1);

  updateMessage("正在生成预览，请稍候...");

  const weightKg =
  Number(document.getElementById("weightInput").value) || 65;

  try {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: start.toISOString(),
        points: getPointsForExport(),
        paceSecondsPerKm,
        hrRest,
        hrMax,
        lapCount,
        weightKg
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      updateMessage(err.error || "预览失败", true);
      return;
    }

    const data = await res.json();
    renderPreviewCharts(data);

    const km = (data.totalDistanceMeters / 1000).toFixed(2);
    const min = (data.totalDurationSec / 60).toFixed(1);
    updateMessage(`预览已生成，总距离约 ${km} 公里，总时间约 ${min} 分钟`);
    previewData = data;
    previewIndex = 0;
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
    if (previewMarker) {
      map.removeLayer(previewMarker);
      previewMarker = null;
    }
    const samples = previewData.samples || [];
    if (samples.length > 0) {
      const first = samples[0];
      previewMarker = L.circleMarker([first.lat, first.lng], {
        radius: 6,
        color: "#111111"
      }).addTo(map);
      startPreviewPlayback();
    }
  } catch (e) {
    console.error(e);
    updateMessage("预览请求失败，请稍后重试", true);
  }
}

const previewBtn = document.getElementById("previewBtn");
if (previewBtn) {
  previewBtn.addEventListener("click", previewActivity);
}

function updateLiveInfo(sample) {
  const el = document.getElementById("liveInfo");
  if (!el || !sample) return;
  const t = Math.max(0, sample.timeSec || 0);
  const min = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const speed = sample.speed > 0 ? sample.speed : 0.01;
  const secPerKm = 1000 / speed;
  const paceMin = Math.floor(secPerKm / 60);
  const paceSec = Math.round(secPerKm % 60);
  const paceStr = `${paceMin}'${paceSec.toString().padStart(2, "0")}"/km`;
  const hr = sample.heartRate || 0;
  el.textContent = `时间 ${min}:${sec.toString().padStart(2, "0")}  配速 ${paceStr}  心率 ${hr} bpm`;
}

function startPreviewPlayback() {
  const samples = previewData?.samples || [];
  if (!samples.length) return;

  const totalSamples = samples.length;
  const stepMs = 100;
  previewIndex = 0;

  if (previewTimer) {
    clearInterval(previewTimer);
  }

  previewTimer = setInterval(() => {
    if (previewIndex >= totalSamples) {
      clearInterval(previewTimer);
      previewTimer = null;
      return;
    }
    const s = samples[previewIndex];
    if (previewMarker && s.lat != null && s.lng != null) {
      previewMarker.setLatLng([s.lat, s.lng]);
    }
    updateLiveInfo(s);
    previewIndex += 1;
  }, stepMs);
}

// ===== 面板位置与尺寸自由调整（移动 / 调宽 / 调高 / 角拖）=====
{
  const sidebar = document.querySelector(".sidebar");
  const dragZone = document.getElementById("panelDragZone");
  const gripMove = document.getElementById("gripMove");
  const handleR = document.getElementById("resizeHandle");
  const handleB = document.getElementById("resizeHandleB");
  const handleC = document.getElementById("resizeHandleC");
  const SIDEBAR_WIDTH_KEY = "fit_sidebar_width";
  const PANEL_POS_KEY = "fit_panel_pos";
  const PANEL_H_KEY = "fit_panel_height";
  const SIDEBAR_MIN_W = 280;
  const SIDEBAR_MAX_W = 600;
  const SIDEBAR_DEFAULT_W = 380;
  const PANEL_MIN_H = 240;
  const PANEL_EDGE = 8;      // 面板与屏幕边缘的最小间距
  const PANEL_VISIBLE = 140; // 拖动时面板至少保留在屏幕内的宽度

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 地图尺寸重算按帧合并，拖动时避免每个像素位移都触发布局抖动
  let mapInvalidatePending = false;
  function scheduleMapInvalidate() {
    if (mapInvalidatePending) return;
    mapInvalidatePending = true;
    requestAnimationFrame(() => {
      mapInvalidatePending = false;
      map.invalidateSize();
    });
  }

  const setPanelVar = (name, value) =>
    document.documentElement.style.setProperty(name, value);

  // ---- 宽度 ----
  function applySidebarWidth(w, persist = false) {
    const cw = clamp(w, SIDEBAR_MIN_W, SIDEBAR_MAX_W);
    setPanelVar("--sidebar-w", cw + "px");
    if (persist) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(cw));
    scheduleMapInvalidate();
    return cw;
  }

  // ---- 高度（不超过屏幕底部）----
  function applyPanelHeight(h, persist = false) {
    const top = sidebar.getBoundingClientRect().top;
    const maxH = Math.max(PANEL_MIN_H, window.innerHeight - top - PANEL_EDGE);
    const ch = Math.round(clamp(h, PANEL_MIN_H, maxH));
    setPanelVar("--panel-h", ch + "px");
    if (persist) localStorage.setItem(PANEL_H_KEY, String(ch));
    scheduleMapInvalidate();
    return ch;
  }

  // ---- 位置（拖出屏幕时做软限制：至少保留 PANEL_VISIBLE 宽度可见）----
  function applyPanelPos(left, top, persist = false) {
    const width = sidebar.getBoundingClientRect().width;
    const l = Math.round(clamp(left, PANEL_EDGE - width + PANEL_VISIBLE, window.innerWidth - PANEL_VISIBLE));
    // 顶部不能低到让最小高度都放不下
    const t = Math.round(clamp(top, PANEL_EDGE, window.innerHeight - PANEL_MIN_H - PANEL_EDGE));
    setPanelVar("--panel-left", l + "px");
    setPanelVar("--panel-top", t + "px");
    if (persist) localStorage.setItem(PANEL_POS_KEY, `${l},${t}`);
    // 移动后高度若超出屏幕底部，立即收回来（默认高度是撑满整屏的）
    const rect = sidebar.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - PANEL_EDGE) {
      applyPanelHeight(rect.height);
    }
    return { l, t };
  }

  // ---- 模式：固定（停靠）/ 移动（自由摆放），默认固定 ----
  const PANEL_MODE_KEY = "fit_panel_mode";
  let panelMode = localStorage.getItem(PANEL_MODE_KEY) === "free" ? "free" : "docked";
  const DOCKED_INSET = 12;

  function applyDockedGeometry() {
    setPanelVar("--panel-left", DOCKED_INSET + "px");
    setPanelVar("--panel-top", DOCKED_INSET + "px");
    setPanelVar("--panel-h", (window.innerHeight - DOCKED_INSET * 2) + "px");
  }

  function setPanelMode(mode, persist = true) {
    panelMode = mode;
    document.body.classList.toggle("panel-docked", mode === "docked");
    if (mode === "docked") {
      // 停靠：左上角、撑满高度（宽度记忆保留，与原版一致）
      applyDockedGeometry();
    } else {
      // 自由：恢复上次的位置/高度；没有就从此刻停靠位置起步
      const savedPos = localStorage.getItem(PANEL_POS_KEY);
      if (savedPos) {
        const [pl, pt] = savedPos.split(",").map(Number);
        if (Number.isFinite(pl) && Number.isFinite(pt)) {
          applyPanelPos(pl, pt);
        } else {
          const rect = sidebar.getBoundingClientRect();
          setPanelVar("--panel-left", Math.round(rect.left) + "px");
          setPanelVar("--panel-top", Math.round(rect.top) + "px");
        }
      } else {
        const rect = sidebar.getBoundingClientRect();
        setPanelVar("--panel-left", Math.round(rect.left) + "px");
        setPanelVar("--panel-top", Math.round(rect.top) + "px");
      }
      const savedH = parseInt(localStorage.getItem(PANEL_H_KEY), 10);
      if (Number.isFinite(savedH)) {
        applyPanelHeight(savedH);
      } else {
        setPanelVar("--panel-h", Math.round(sidebar.getBoundingClientRect().height) + "px");
      }
    }
    document.querySelectorAll("#panelMode .mode-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.mode === mode));
    if (persist) localStorage.setItem(PANEL_MODE_KEY, mode);
    scheduleMapInvalidate();
  }

  // ---- 恢复：宽度总是生效；位置/高度仅移动模式生效 ----
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  if (Number.isFinite(savedWidth)) applySidebarWidth(savedWidth);
  setPanelMode(panelMode, false);

  // 分段控件：固定 / 移动
  const modeSwitch = document.getElementById("panelMode");
  modeSwitch?.addEventListener("click", (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn || btn.dataset.mode === panelMode) return;
    setPanelMode(btn.dataset.mode);
    updateMessage(mode === "docked" ? "面板已固定（左上停靠）" : "面板已切换为自由移动");
  });

  // ---- 移动面板：标题区 / 右上角六点抓手（统一在 dragZone 上捕获）----
  if (dragZone && sidebar) {
    let moving = false;
    let moveStartX = 0, moveStartY = 0, moveBaseL = 0, moveBaseT = 0;

    dragZone.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || panelMode === "docked") return;
      // 分段控件（固定/移动）要自己接收点击；一旦这里捕获指针，click 会重定向到 dragZone
      if (e.target.closest("#panelMode")) return;
      e.preventDefault();
      dragZone.setPointerCapture(e.pointerId);
      moving = true;
      moveStartX = e.clientX;
      moveStartY = e.clientY;
      const rect = sidebar.getBoundingClientRect();
      moveBaseL = rect.left;
      moveBaseT = rect.top;
      document.body.classList.add("panel-moving");
    });
    dragZone.addEventListener("pointermove", (e) => {
      if (!moving) return;
      applyPanelPos(moveBaseL + (e.clientX - moveStartX), moveBaseT + (e.clientY - moveStartY));
    });
    const endMove = () => {
      if (!moving) return;
      moving = false;
      document.body.classList.remove("panel-moving");
      const rect = sidebar.getBoundingClientRect();
      localStorage.setItem(PANEL_POS_KEY, `${Math.round(rect.left)},${Math.round(rect.top)}`);
    };
    dragZone.addEventListener("pointerup", endMove);
    dragZone.addEventListener("pointercancel", endMove);

    // 双击抓手：面板位置复位（回左上角停靠位）。
    // 注意自由模式下指针捕获会把 click/dblclick 重定向到 dragZone，所以监听在 dragZone 上
    dragZone.addEventListener("dblclick", (e) => {
      if (!e.target.closest("#gripMove")) return;
      e.stopPropagation();
      localStorage.removeItem(PANEL_POS_KEY);
      document.documentElement.style.removeProperty("--panel-left");
      document.documentElement.style.removeProperty("--panel-top");
      scheduleMapInvalidate();
    });

    // 键盘移动面板（抓手聚焦后）
    gripMove?.addEventListener("keydown", (e) => {
      const rect = sidebar.getBoundingClientRect();
      let nl = rect.left, nt = rect.top, handled = false;
      if (e.key === "ArrowLeft") { nl -= 16; handled = true; }
      else if (e.key === "ArrowRight") { nl += 16; handled = true; }
      else if (e.key === "ArrowUp") { nt -= 16; handled = true; }
      else if (e.key === "ArrowDown") { nt += 16; handled = true; }
      if (handled) {
        e.preventDefault();
        applyPanelPos(nl, nt, true);
      }
    });
  }

  // ---- 右缘：调宽 ----
  if (handleR && sidebar) {
    let resizing = false;
    let startX = 0, baseW = SIDEBAR_DEFAULT_W;

    handleR.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handleR.setPointerCapture(e.pointerId);
      resizing = true;
      startX = e.clientX;
      baseW = sidebar.getBoundingClientRect().width;
      handleR.classList.add("dragging");
      document.body.classList.add("resizing");
    });
    handleR.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      applySidebarWidth(baseW + (e.clientX - startX));
    });
    const endR = () => {
      if (!resizing) return;
      resizing = false;
      handleR.classList.remove("dragging");
      document.body.classList.remove("resizing");
      localStorage.setItem(
        SIDEBAR_WIDTH_KEY,
        String(clamp(sidebar.getBoundingClientRect().width, SIDEBAR_MIN_W, SIDEBAR_MAX_W))
      );
      scheduleMapInvalidate();
    };
    handleR.addEventListener("pointerup", endR);
    handleR.addEventListener("pointercancel", endR);

    handleR.addEventListener("dblclick", () => applySidebarWidth(SIDEBAR_DEFAULT_W, true));
    handleR.addEventListener("keydown", (e) => {
      const current = sidebar.getBoundingClientRect().width;
      let next = null;
      if (e.key === "ArrowLeft") next = current - 16;
      else if (e.key === "ArrowRight") next = current + 16;
      else if (e.key === "Home") next = SIDEBAR_MIN_W;
      else if (e.key === "End") next = SIDEBAR_MAX_W;
      if (next !== null) {
        e.preventDefault();
        applySidebarWidth(next, true);
      }
    });
  }

  // ---- 底缘：调高 ----
  if (handleB && sidebar) {
    let resizing = false;
    let startY = 0, baseH = 0;

    handleB.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || panelMode === "docked") return;
      e.preventDefault();
      handleB.setPointerCapture(e.pointerId);
      resizing = true;
      startY = e.clientY;
      baseH = sidebar.getBoundingClientRect().height;
      handleB.classList.add("dragging");
      document.body.classList.add("resizing");
    });
    handleB.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      applyPanelHeight(baseH + (e.clientY - startY));
    });
    const endB = () => {
      if (!resizing) return;
      resizing = false;
      handleB.classList.remove("dragging");
      document.body.classList.remove("resizing");
      localStorage.setItem(
        PANEL_H_KEY,
        String(Math.round(sidebar.getBoundingClientRect().height))
      );
      scheduleMapInvalidate();
    };
    handleB.addEventListener("pointerup", endB);
    handleB.addEventListener("pointercancel", endB);

    // 双击复位高度（移除变量回到 CSS 默认：撑满可视高度）
    handleB.addEventListener("dblclick", () => {
      localStorage.removeItem(PANEL_H_KEY);
      document.documentElement.style.removeProperty("--panel-h");
      scheduleMapInvalidate();
    });
    handleB.addEventListener("keydown", (e) => {
      const current = sidebar.getBoundingClientRect().height;
      let next = null;
      if (e.key === "ArrowUp") next = current - 16;
      else if (e.key === "ArrowDown") next = current + 16;
      if (next !== null) {
        e.preventDefault();
        applyPanelHeight(next, true);
      }
    });
  }

  // ---- 右下角：宽 + 高 同时调 ----
  if (handleC && sidebar) {
    let resizing = false;
    let startX = 0, startY = 0, baseW = 0, baseH = 0;

    handleC.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || panelMode === "docked") return;
      e.preventDefault();
      handleC.setPointerCapture(e.pointerId);
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = sidebar.getBoundingClientRect();
      baseW = rect.width;
      baseH = rect.height;
      handleC.classList.add("dragging");
      document.body.classList.add("resizing");
    });
    handleC.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      applySidebarWidth(baseW + (e.clientX - startX));
      applyPanelHeight(baseH + (e.clientY - startY));
    });
    const endC = () => {
      if (!resizing) return;
      resizing = false;
      handleC.classList.remove("dragging");
      document.body.classList.remove("resizing");
      const rect = sidebar.getBoundingClientRect();
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(rect.width)));
      localStorage.setItem(PANEL_H_KEY, String(Math.round(rect.height)));
      scheduleMapInvalidate();
    };
    handleC.addEventListener("pointerup", endC);
    handleC.addEventListener("pointercancel", endC);

    handleC.addEventListener("dblclick", () => {
      localStorage.removeItem(PANEL_H_KEY);
      document.documentElement.style.removeProperty("--panel-h");
      applySidebarWidth(SIDEBAR_DEFAULT_W, true);
    });
  }

  // ---- 窗口缩放时把面板夹回可视范围（固定模式则重算停靠几何）----
  window.addEventListener("resize", () => {
    if (panelMode === "docked") {
      applyDockedGeometry();
      return;
    }
    const rect = sidebar.getBoundingClientRect();
    if (rect.left > window.innerWidth - PANEL_VISIBLE ||
        rect.top > window.innerHeight - 72) {
      applyPanelPos(rect.left, rect.top);
    }
    if (rect.bottom > window.innerHeight - PANEL_EDGE) {
      applyPanelHeight(rect.height);
    }
  });
}
