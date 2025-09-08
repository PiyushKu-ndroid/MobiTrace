/* ================================================================
   Rural Bus Tracker - demo app.js
   - Replace firebaseConfig with your project's config below
   - Uses:
     - Firebase Realtime Database (compat SDK)
     - Leaflet for maps
     - jsQR for QR decoding (camera)
     - qrcodejs for QR generation
   ================================================================ */

/* ----------------- FIREBASE CONFIG - REPLACE THIS ----------------- */
/* ----------------- FIREBASE CONFIG (YOUR PROJECT) ----------------- */
const firebaseConfig = {
  apiKey: "AIzaSyAq5XKTrM8R083UyzCTeHoTtNZNnGn_3oM",
  authDomain: "mobitrace-893c6.firebaseapp.com",
  databaseURL: "https://mobitrace-893c6-default-rtdb.asia-southeast1.firebasedatabase.app",  // ✅ important
  projectId: "mobitrace-893c6",
  storageBucket: "mobitrace-893c6.appspot.com", // ✅ corrected
  messagingSenderId: "404936505239",
  appId: "1:404936505239:web:5dd1eb63f9129a514636d2",
  measurementId: "G-EB04LCLX7J"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
/* ----------------------------------------------------------------- */

/* ----------------------------------------------------------------- */

/* Basic app state */
let videoStream = null;
let scanning = false;
let scanInterval = null;
let watchId = null; // geolocation watch
let simulateInterval = null;

/* UI elements */
const splash = document.getElementById("splash");
const app = document.getElementById("app");
const navBtns = document.querySelectorAll(".nav-btn");
const views = {
  home: document.getElementById("homeView"),
  admin: document.getElementById("adminView"),
  driver: document.getElementById("driverView"),
  track: document.getElementById("trackView")
};

/* NAV helpers */
function showView(name){
  // header nav active
  navBtns.forEach(b => b.classList.remove("active"));
  document.getElementById("btnHome").classList.toggle("active", name==="home");
  document.getElementById("btnAdmin").classList.toggle("active", name==="admin");
  document.getElementById("btnDriver").classList.toggle("active", name==="driver");
  document.getElementById("btnTrack").classList.toggle("active", name==="track");

  // show/hide views
  for (const k in views) views[k].classList.add("hidden");
  views[name].classList.remove("hidden");
}

/* Splash -> App */
  window.addEventListener("load", () => {
  setTimeout(() => {
    splash.classList.add("hidden");  // fade out splash
    app.classList.remove("hidden");  // show main app
    showView("home");                // default view

    // 🔥 Fix map resize issue on mobile
    setTimeout(() => {
      if (window.myMap) {
        window.myMap.invalidateSize();
      }
    }, 500); // wait a bit after showing app
  }, 2000); // splash duration
});

/* header buttons */
document.getElementById("btnHome").addEventListener("click", ()=> showView("home"));
document.getElementById("btnAdmin").addEventListener("click", ()=> showView("admin"));
document.getElementById("btnDriver").addEventListener("click", ()=> showView("driver"));
document.getElementById("btnTrack").addEventListener("click", ()=> showView("track"));

/* Home quick buttons */
document.getElementById("gotoDriver").addEventListener("click", ()=> showView("driver"));
document.getElementById("gotoTrack").addEventListener("click", ()=> showView("track"));
document.getElementById("gotoAdmin").addEventListener("click", ()=> showView("admin"));

/* ----------------- ADMIN: create bus and QR ----------------- */
const createBusBtn = document.getElementById("createBusBtn");
const adminBusIdInput = document.getElementById("adminBusId");
const adminBusNameInput = document.getElementById("adminBusName");
const qrcodeDiv = document.getElementById("qrcode");
const qrcodeLabel = document.getElementById("qrcodeLabel");
const adminBusList = document.getElementById("adminBusList");
const refreshBusesBtn = document.getElementById("refreshBusesBtn");

createBusBtn.addEventListener("click", async () => {
  const id = (adminBusIdInput.value || "").trim();
  const name = (adminBusNameInput.value || "").trim();

  if (!id) return alert("Please enter a unique Bus ID (e.g. bus12)");
  // write metadata to database
  await db.ref("busesMeta/" + id).set({
    name: name || id,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });

  // generate QR containing the bus id
  qrcodeDiv.innerHTML = "";
  new QRCode(qrcodeDiv, { text: id, width: 160, height: 160 });
  qrcodeLabel.innerText = `QR for bus id: ${id}`;
  adminBusIdInput.value = "";
  adminBusNameInput.value = "";
  refreshBuses();
});

refreshBusesBtn.addEventListener("click", refreshBuses);

async function refreshBuses(){
  adminBusList.innerHTML = "<li class='muted'>Loading…</li>";
  const snapshot = await db.ref("busesMeta").once("value");
  const data = snapshot.val() || {};
  adminBusList.innerHTML = "";
  for (const id of Object.keys(data)) {
    const li = document.createElement("li");
    li.innerText = `${id} — ${data[id].name || ""}`;
    adminBusList.appendChild(li);
  }
  // also refresh passenger dropdown
  populateBusSelect();
}

/* ----------------- DRIVER: QR scan + start/stop sharing ----------------- */
const startScanBtn = document.getElementById("startScanBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const video = document.getElementById("video");
const qrCanvas = document.getElementById("qrCanvas");
const driverBusIdInput = document.getElementById("driverBusId");
const driverStatusDiv = document.getElementById("driverStatus");
const startShareBtn = document.getElementById("startShareBtn");
const stopShareBtn = document.getElementById("stopShareBtn");
const simulateRouteSelect = document.getElementById("simulateRouteSelect");

startScanBtn.addEventListener("click", startScanner);
stopScanBtn.addEventListener("click", stopScanner);

async function startScanner(){
  if (scanning) return;
  // request camera
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.play();
    video.style.display = "block";
    videoStream = stream;
    scanning = true;
    startScanBtn.disabled = true;
    stopScanBtn.disabled = false;
    driverStatusDiv.innerText = "Status: Scanning QR… point camera at code";

    // set up canvas for processing
    const ctxCanvas = qrCanvas.getContext("2d");
    qrCanvas.width = 400;
    qrCanvas.height = 300;
    scanInterval = setInterval(() => {
      try {
        ctxCanvas.drawImage(video, 0,0, qrCanvas.width, qrCanvas.height);
        const imageData = ctxCanvas.getImageData(0,0, qrCanvas.width, qrCanvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          // found QR data
          stopScanner();
          driverBusIdInput.value = code.data;
          driverStatusDiv.innerText = `Status: Scanned bus id "${code.data}"`;
        }
      } catch(err){
        // ignore draw errors if any frame fails
      }
    }, 250);
  } catch (err) {
    alert("Camera access failed. You can enter bus id manually.");
    console.error(err);
  }
}

function stopScanner(){
  scanning = false;
  startScanBtn.disabled = false;
  stopScanBtn.disabled = true;
  driverStatusDiv.innerText = "Status: Scanner stopped";
  if (videoStream) {
    videoStream.getTracks().forEach(t=>t.stop());
    video.srcObject = null;
  }
  if (scanInterval) clearInterval(scanInterval);
}

/* DRIVER: start / stop sharing (real gps or simulated route) */
startShareBtn.addEventListener("click", startSharing);
stopShareBtn.addEventListener("click", stopSharing);

async function startSharing(){
  const busId = (driverBusIdInput.value || "").trim();
  if (!busId) return alert("Please scan QR or enter Bus ID first.");

  // Mark as sharing in DB
  await db.ref("busesLocations/" + busId + "/meta").set({
    sharing: true,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  });

  // if simulation selected, run simulated route
  const sim = simulateRouteSelect.value;
  if (sim && sim !== "none") {
    startSimulateRoute(busId);
    driverStatusDiv.innerText = `Status: Simulating route for ${busId}`;
    startShareBtn.disabled = true;
    stopShareBtn.disabled = false;
    return;
  }

  // Use geolocation to send live location
  if (!("geolocation" in navigator)) {
    alert("Geolocation not available in this browser. Use simulation.");
    return;
  }

  driverStatusDiv.innerText = "Status: waiting for location permission…";
  // start watchPosition
  watchId = navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    await db.ref("busesLocations/" + busId + "/location").set({
      lat, lng, ts: firebase.database.ServerValue.TIMESTAMP
    });
    driverStatusDiv.innerText = `Status: sharing (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }, (err) => {
    console.warn("geolocation error", err);
    driverStatusDiv.innerText = "Status: geolocation error - " + (err.message || err.code);
  }, { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });

  startShareBtn.disabled = true;
  stopShareBtn.disabled = false;
}

function stopSharing(){
  const busId = (driverBusIdInput.value || "").trim();
  if (!busId) {
    driverStatusDiv.innerText = "Status: stopped";
  } else {
    // mark not sharing
    db.ref("busesLocations/" + busId + "/meta").set({sharing:false, updatedAt: firebase.database.ServerValue.TIMESTAMP});
    db.ref("busesLocations/" + busId + "/location").remove().catch(()=>{});
    driverStatusDiv.innerText = "Status: stopped";
  }
  // clear geolocation
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  // clear simulation
  if (simulateInterval) {
    clearInterval(simulateInterval);
    simulateInterval = null;
  }
  startShareBtn.disabled = false;
  stopShareBtn.disabled = true;
}

/* Simple demo simulation route (loops) */
function startSimulateRoute(busId){
  const route = [
    [22.5726, 88.3639],
    [22.5760, 88.3670],
    [22.5795, 88.3720],
    [22.5840, 88.3775],
    [22.5890, 88.3820],
    [22.5930, 88.3880]
  ];
  let i = 0;
  // put initial meta
  db.ref("busesLocations/" + busId + "/meta").set({sharing:true, updatedAt: firebase.database.ServerValue.TIMESTAMP});
  simulateInterval = setInterval(() => {
    const [lat,lng] = route[i];
    db.ref("busesLocations/" + busId + "/location").set({lat,lng,ts:firebase.database.ServerValue.TIMESTAMP});
    i++; if (i >= route.length) i = 0;
  }, 1800);
}

/* ----------------- TRACK: Passenger UI & Live Map ----------------- */
let map, busMarker, userStopMarker;
let followBus = true;
const busSelect = document.getElementById("busSelect");
const followCheckbox = document.getElementById("followCheckbox");
const setStopBtn = document.getElementById("setStopBtn");
const etaBox = document.getElementById("etaBox");
const trackStatus = document.getElementById("trackStatus");

followCheckbox.addEventListener("change", () => followBus = followCheckbox.checked);
setStopBtn.addEventListener("click", () => toggleSetStopMode());

let selectingStop = false;
function toggleSetStopMode(){
  selectingStop = !selectingStop;
  setStopBtn.innerText = selectingStop ? "Click map to pick stop (Cancel)" : "Enable Set Stop";
  if (selectingStop) {
    trackStatus.innerText = "Click on the map to set your stop";
  } else {
    trackStatus.innerText = "Mode: normal";
  }
}

function initMap(){
  if (map) return;
  map = L.map('map').setView([22.5795, 88.3720], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // bus marker placeholder
  busMarker = L.marker([22.5726, 88.3639], {
    icon: L.divIcon({ html: "🚌", className:"", iconSize:[28,28] })
  }).addTo(map);

  // user stop click handler
  map.on('click', (e) => {
    if (!selectingStop) return;
    if (userStopMarker) map.removeLayer(userStopMarker);
    userStopMarker = L.marker([e.latlng.lat, e.latlng.lng], {icon: L.divIcon({html:"📍", className:"", iconSize:[22,22]})}).addTo(map);
    selectingStop = false;
    setStopBtn.innerText = "Enable Set Stop";
    trackStatus.innerText = "Stop set. Waiting for bus...";
    computeAndShowETA(); // compute immediately when possible
  });

  // populate bus select once map is ready
  populateBusSelect();
}

/* populate bus dropdown by reading metadata from firebase */
async function populateBusSelect(){
  busSelect.innerHTML = "<option>Loading…</option>";
  const snap = await db.ref("busesMeta").once("value");
  const data = snap.val() || {};
  busSelect.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.innerText = data ? "Select bus to track" : "No buses available";
  busSelect.appendChild(defaultOpt);

  for (const id of Object.keys(data)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.innerText = `${id} — ${data[id].name || ""}`;
    busSelect.appendChild(opt);
  }
}

/* Listen to selected bus in dropdown */
busSelect.addEventListener("change", (e) => {
  const id = e.target.value;
  if (!id) return;
  trackStatus.innerText = `Tracking ${id}…`;
  startListeningBus(id);
});

/* Start listening to firebase for a given bus id */
let currentListeningBus = null;
function startListeningBus(busId){
  if (!busId) return;

  // detach previous listener
  if (currentListeningBus) db.ref("busesLocations/" + currentListeningBus + "/location").off();

  currentListeningBus = busId;
  const locRef = db.ref("busesLocations/" + busId + "/location");
  locRef.on('value', (snap) => {
  const coords = snap.val();
  if (!coords) {
    trackStatus.innerText = "No live location shared currently";
    return;
  }
  const lat = coords.lat;
  const lng = coords.lng;

  // Smoothly move bus marker
  busMarker.setLatLng([lat, lng], { animate: true, duration: 1.5 });

  // Optional: add pulsing circle around bus
  if (window.busPulseCircle) map.removeLayer(window.busPulseCircle); // remove previous
  window.busPulseCircle = L.circle([lat, lng], {
    radius: 50,
    color: '#22c55e',
    fillColor: '#22c55e',
    fillOpacity: 0.3
  }).addTo(map);

  if (followBus) map.panTo([lat, lng]);
  trackStatus.innerText = `Live: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  computeAndShowETA();
});

}

/* compute ETA from bus to user stop (if set) using avg speed */
const avgSpeedKmh = 30;
function computeAndShowETA(){
  if (!currentListeningBus) {
    etaBox.innerText = "ETA: select a bus";
    return;
  }
  if (!userStopMarker) {
    etaBox.innerText = "ETA: set your stop (click Set Stop)";
    return;
  }
  const busLatLng = busMarker.getLatLng();
  const userLatLng = userStopMarker.getLatLng();
  const distKm = haversineDistance([busLatLng.lat, busLatLng.lng], [userLatLng.lat, userLatLng.lng]);
  const minutes = Math.round((distKm / avgSpeedKmh) * 60);
  etaBox.innerText = `ETA: ~ ${minutes} min (${distKm.toFixed(2)} km)`;
}

/* Haversine (km) */
function haversineDistance(a,b){
  const R = 6371;
  const lat1 = a[0]*Math.PI/180; const lon1 = a[1]*Math.PI/180;
  const lat2 = b[0]*Math.PI/180; const lon2 = b[1]*Math.PI/180;
  const dlat = lat2-lat1; const dlon = lon2-lon1;
  const aa = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  return R*c;
}

/* init when user opens Track */
document.getElementById("btnTrack").addEventListener("click", initMap);
document.getElementById("gotoTrack").addEventListener("click", initMap);

/* load known buses on startup */
refreshBuses(); // from admin function also calls populateBusSelect()

/* OPTIONAL: handle page unload for safety */
window.addEventListener("beforeunload", () => {
  stopScanner();
  stopSharing();
});

