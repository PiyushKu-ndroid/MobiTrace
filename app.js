/* ================================================================
   MobiTrace - app.js (WebRTC + Firestore + PWA)
================================================================ */

// ---------------- FIREBASE CONFIG ----------------
const firebaseConfig = {
    apiKey: "AIzaSyAq5XKTrM8R083UyzCTeHoTtNZNnGn_3oM",
    authDomain: "mobitrace-893c6.firebaseapp.com",
    databaseURL: "https://mobitrace-893c6-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mobitrace-893c6",
    storageBucket: "mobitrace-893c6.appspot.com",
    messagingSenderId: "404936505239",
    appId: "1:404936505239:web:5dd1eb63f9129a514636d2",
    measurementId: "G-EB04LCLX7J"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.enablePersistence().catch(err => console.log("Persistence error", err));

/* ---------------- BASIC APP STATE ---------------- */
let videoStream = null;
let scanning = false;
let scanInterval = null;
let watchId = null;
let simulateInterval = null;
let lastCreatedBusId = null; 

/* ---------------- UI ELEMENTS ---------------- */
const splash = document.getElementById("splash");
const app = document.getElementById("app");
const navBtns = document.querySelectorAll(".nav-btn");
const views = {
    home: document.getElementById("homeView"),
    admin: document.getElementById("adminView"),
    driver: document.getElementById("driverView"),
    track: document.getElementById("trackView")
};
const driverStatusDiv = document.getElementById("driverStatus");

/* ---------------- NAV HELPERS ---------------- */
function showView(name){
    navBtns.forEach(b => b.classList.remove("active"));
    document.getElementById("btnHome").classList.toggle("active", name==="home");
    document.getElementById("btnAdmin").classList.toggle("active", name==="admin");
    document.getElementById("btnDriver").classList.toggle("active", name==="driver");
    document.getElementById("btnTrack").classList.toggle("active", name==="track");
    for (const k in views) views[k].classList.add("hidden");
    views[name].classList.remove("hidden");
}

/* ---------------- STARTUP LOGIC ---------------- */
window.addEventListener("load", () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const viewName = urlParams.get('view');
        const busIdFromUrl = urlParams.get('busId');

        setTimeout(() => {
            splash.classList.add("hidden");
            app.classList.remove("hidden");

            if (viewName) {
                showView(viewName);
                if (viewName === "driver" && busIdFromUrl) {
                    if (driverBusIdInput && driverStatusDiv) {
                        driverBusIdInput.value = busIdFromUrl;
                        driverStatusDiv.innerText = `Status: Bus ID "${busIdFromUrl}" pre-filled from QR code.`;
                    }
                }
            } else {
                showView("home");
            }

            if (window.myMap) window.myMap.invalidateSize();
        }, 500);

    } catch (err) {
        console.error("Error during load:", err);
        splash.classList.add("hidden");
        app.classList.remove("hidden");
    }
});

/* ---------------- HEADER BUTTONS ---------------- */
document.getElementById("btnHome").addEventListener("click", () => showView("home"));
document.getElementById("btnAdmin").addEventListener("click", () => showView("admin"));
document.getElementById("btnDriver").addEventListener("click", () => showView("driver"));
document.getElementById("btnTrack").addEventListener("click", () => showView("track"));

document.getElementById("gotoDriver").addEventListener("click", () => showView("driver"));
document.getElementById("gotoTrack").addEventListener("click", () => showView("track"));
document.getElementById("gotoAdmin").addEventListener("click", () => showView("admin"));

/* ===============================================================
   ADMIN: CREATE BUS & QR
================================================================ */
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

    const baseUrl = "https://mobi-trace.vercel.app/";
    const qrCodeUrl = `${baseUrl}?view=driver&busId=${encodeURIComponent(id)}`;

    await db.collection("busesMeta").doc(id).set({
        name: name || id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    qrcodeDiv.innerHTML = "";
    new QRCode(qrcodeDiv, { text: qrCodeUrl, width: 160, height: 160 });
    qrcodeLabel.innerText = `QR for bus id: ${id}`;

    lastCreatedBusId = id;
    adminBusIdInput.value = "";
    adminBusNameInput.value = "";
    refreshBuses();
});

document.getElementById("downloadQR").onclick = () => {
    const canvas = qrcodeDiv.querySelector("canvas");
    if (!canvas) return alert("QR not ready yet.");
    if (!lastCreatedBusId) return alert("No QR generated yet.");

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${lastCreatedBusId}_qr.png`;
    link.click();
};

refreshBusesBtn.addEventListener("click", refreshBuses);

async function refreshBuses() {
    adminBusList.innerHTML = "<li class='muted'>Loading…</li>";
    const snapshot = await db.collection("busesMeta").get();
    adminBusList.innerHTML = "";
    snapshot.forEach(doc => {
        const data = doc.data();
        const li = document.createElement("li");
        li.innerText = `${doc.id} — ${data.name || ""}`;
        adminBusList.appendChild(li);
    });
    populateBusSelect();
}

/* ---------------- ADMIN MAP ---------------- */
let adminMap, adminMarkers = [], adminRouteControl = null;

function initAdminMap(){
    if (adminMap) return;
    adminMap = L.map('adminMap').setView([22.5795, 88.3720], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(adminMap);

    adminMap.on('click', async (e) => {
        if (adminMarkers.length >= 2) return;
        const marker = L.marker(e.latlng, { draggable: true }).addTo(adminMap);
        adminMarkers.push(marker);
        marker.on('dragend', drawAdminRoute);

        if (adminMarkers.length === 2) drawAdminRoute();
    });

    document.getElementById("resetRouteBtn").addEventListener("click", () => {
        adminMarkers.forEach(m => adminMap.removeLayer(m));
        adminMarkers = [];
        if (adminRouteControl) adminMap.removeControl(adminRouteControl);
        adminRouteControl = null;
    });
}

function drawAdminRoute(){
    if (adminRouteControl) adminMap.removeControl(adminRouteControl);
    if (adminMarkers.length < 2) return;

    // Draw the route
    adminRouteControl = L.Routing.control({
        waypoints: adminMarkers.map(m => m.getLatLng()),
        routeWhileDragging: true
    }).addTo(adminMap);

    // Optional: Save route to Firebase
    const routeCoords = adminMarkers.map(m => {
        const ll = m.getLatLng();
        return { lat: ll.lat, lng: ll.lng };
    });
    console.log("Admin Route Coordinates:", routeCoords);

    // ----------------- AUTO FILL DISPLAY NAME -----------------
    const start = routeCoords[0];
    const end = routeCoords[1];

    // Simple readable format
    const displayName = `Route: (${start.lat.toFixed(3)}, ${start.lng.toFixed(3)}) → (${end.lat.toFixed(3)}, ${end.lng.toFixed(3)})`;

    // Auto fill input
    adminBusNameInput.value = displayName;

    // Optional: If you want, you can also save the route in Firestore
    // db.collection("busesRoutes").doc(lastCreatedBusId || "temp").set(routeCoords);
}


document.getElementById("btnAdmin").addEventListener("click", initAdminMap);
document.getElementById("gotoAdmin").addEventListener("click", initAdminMap);

/* ===============================================================
   DRIVER: START / STOP SHARING (WebRTC + Firestore + Simulation)
================================================================ */
const video = document.getElementById("video");
const startShareBtn = document.getElementById("startShareBtn");
const stopShareBtn = document.getElementById("stopShareBtn");
const simulateRouteSelect = document.getElementById("simulateRouteSelect");
const driverBusIdInput = document.getElementById("driverBusId");
const busDatalist = document.getElementById("busIdOptions");

/* Load bus IDs into datalist */
async function loadBusOptions() {
    try{
        const snapshot = await db.collection("busesMeta").get();
        busDatalist.innerHTML = "";
        snapshot.forEach(doc => {
            const opt = document.createElement("option");
            opt.value = doc.id;
            busDatalist.appendChild(opt);
        });
    }catch(err){
        console.error("Error loading bus options:", err);
    }
}

/* ---------------- DRIVER: WebRTC ---------------- */
let driverPeerConnection = null;
let driverDataChannel = null;

async function initDriverWebRTC(busId) {
    if (!busId) return console.warn("Bus ID required for WebRTC driver");

    driverPeerConnection = new RTCPeerConnection();
    driverDataChannel = driverPeerConnection.createDataChannel("busLocation");
    driverDataChannel.onopen = () => console.log("Driver DataChannel open");
    driverDataChannel.onclose = () => console.log("Driver DataChannel closed");

    driverPeerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            await db.collection("webrtcSignals").doc(busId)
                .collection("candidates").add(event.candidate.toJSON());
        }
    };

    const offer = await driverPeerConnection.createOffer();
    await driverPeerConnection.setLocalDescription(offer);

    await db.collection("webrtcSignals").doc(busId).set({
        type: "offer",
        sdp: offer.sdp
    });

    db.collection("webrtcSignals").doc(busId).onSnapshot(async (snap) => {
        const data = snap.data();
        if (!data) return;
        if (data.type === "answer") {
            const answer = new RTCSessionDescription({ type: "answer", sdp: data.sdp });
            await driverPeerConnection.setRemoteDescription(answer);
            console.log("Driver set remote description (answer) from tracker");
        }
    });

    db.collection("webrtcSignals").doc(busId)
        .collection("candidates_tracker")
        .onSnapshot((snap) => {
            snap.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    try {
                        await driverPeerConnection.addIceCandidate(change.doc.data());
                    } catch (err) {
                        console.error("Error adding ICE candidate:", err);
                    }
                }
            });
        });
}

function sendDriverLocationWebRTC(lat, lng) {
    if (driverDataChannel && driverDataChannel.readyState === "open") {
        driverDataChannel.send(JSON.stringify({ lat, lng, ts: Date.now() }));
    }
}

/* ---------------- DRIVER: START / STOP ---------------- */
startShareBtn.addEventListener("click", startSharing);
stopShareBtn.addEventListener("click", stopSharing);

async function startSharing(){
    const busId = (driverBusIdInput.value || "").trim();
    if (!busId) return alert("Please scan QR or enter Bus ID first.");

    // Initialize WebRTC driver
    await initDriverWebRTC(busId);

    await db.collection("busesLocations").doc(busId)
        .set({ sharing: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const sim = simulateRouteSelect.value;
    if (sim && sim !== "none") {
        startSimulateRoute(busId);
        driverStatusDiv.innerText = `Status: Simulating route for ${busId}`;
        startShareBtn.disabled = true;
        stopShareBtn.disabled = false;
        return;
    }

    if (!("geolocation" in navigator)) {
        alert("Geolocation not available in this browser. Use simulation.");
        return;
    }

    driverStatusDiv.innerText = "Status: waiting for location permission…";
    watchId = navigator.geolocation.watchPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        db.collection("busesLocations").doc(busId)
            .collection("location").doc("current")
            .set({ lat, lng, ts: firebase.firestore.FieldValue.serverTimestamp() });

        sendDriverLocationWebRTC(lat, lng);

        driverStatusDiv.innerText = `Status: sharing (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }, (err) => {
        console.warn("geolocation error", err);
        driverStatusDiv.innerText = "Status: geolocation error - " + (err.message || err.code);
    }, { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });

    startShareBtn.disabled = true;
    stopShareBtn.disabled = false;
}

function stopSharing() {
    const busId = (driverBusIdInput.value || "").trim();
    if (busId) {
        db.collection("busesLocations").doc(busId).collection("meta").doc("info").set({
            sharing: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        db.collection("busesLocations").doc(busId).collection("location").doc("current").delete().catch(()=>{});
    }

    driverStatusDiv.innerText = "Status: stopped";

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (simulateInterval) {
        clearInterval(simulateInterval);
        simulateInterval = null;
    }

    startShareBtn.disabled = false;
    stopShareBtn.disabled = true;
}

function startSimulateRoute(busId) {
    const route = [
        [22.5726, 88.3639],
        [22.5760, 88.3670],
        [22.5795, 88.3720],
        [22.5840, 88.3775],
        [22.5890, 88.3820],
        [22.5930, 88.3880]
    ];

    let i = 0;

    db.collection("busesLocations").doc(busId).collection("meta").doc("info").set({
        sharing: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    simulateInterval = setInterval(() => {
        const [lat, lng] = route[i];
        db.collection("busesLocations").doc(busId).collection("location").doc("current").set({
            lat, lng, ts: firebase.firestore.FieldValue.serverTimestamp()
        });
        sendDriverLocationWebRTC(lat, lng);
        i++;
        if (i >= route.length) i = 0;
    }, 1800);
}

/* ===============================================================
   TRACKER MAP + LISTEN LIVE BUS (WebRTC)
================================================================ */
let map, busMarker, userStopMarker;
let followBus = true;
const busSelect = document.getElementById("busSelect");
const followCheckbox = document.getElementById("followCheckbox");
const setStopBtn = document.getElementById("setStopBtn");
const etaBox = document.getElementById("etaBox");
const trackStatus = document.getElementById("trackStatus");

let selectingStop = false;
followCheckbox.addEventListener("change", () => followBus = followCheckbox.checked);
setStopBtn.addEventListener("click", () => toggleSetStopMode());

function toggleSetStopMode(){
    selectingStop = !selectingStop;
    setStopBtn.innerText = selectingStop ? "Click map to pick stop (Cancel)" : "Enable Set Stop";
    trackStatus.innerText = selectingStop ? "Click on the map to set your stop" : "Mode: normal";
}

/* ---------------- TRACKER: WebRTC LISTENER ---------------- */
let trackerPeerConnection = null;

async function startListeningBusWebRTC(busId) {
    trackerPeerConnection = new RTCPeerConnection();

    trackerPeerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (busMarker) {
                busMarker.setLatLng([data.lat, data.lng]);
                if (window.busPulseCircle) map.removeLayer(window.busPulseCircle);
                window.busPulseCircle = L.circle([data.lat, data.lng], {
                    radius: 50, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.3
                }).addTo(map);
                if (followBus) map.panTo([data.lat, data.lng]);
                trackStatus.innerText = `Live (WebRTC): ${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`;
                computeAndShowETA();
            }
        };
    };

    trackerPeerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            await db.collection("webrtcSignals").doc(busId)
                .collection("candidates_tracker").add(event.candidate.toJSON());
        }
    };

    const snap = await db.collection("webrtcSignals").doc(busId).get();
    const offerData = snap.data();
    if (!offerData || offerData.type !== "offer") return;

    await trackerPeerConnection.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerData.sdp }));

    const answer = await trackerPeerConnection.createAnswer();
    await trackerPeerConnection.setLocalDescription(answer);

    await db.collection("webrtcSignals").doc(busId).update({
        type: "answer",
        sdp: answer.sdp
    });

    db.collection("webrtcSignals").doc(busId)
        .collection("candidates").onSnapshot((snap) => {
            snap.docChanges().forEach(async (change) => {
                if (change.type === "added") {
                    try {
                        await trackerPeerConnection.addIceCandidate(change.doc.data());
                    } catch (err) {
                        console.error("Error adding ICE candidate (tracker):", err);
                    }
                }
            });
        });
}

/* ---------------- TRACKER MAP INIT ---------------- */
function initMap(){
    if (map) return;

    map = L.map('map').setView([22.5795, 88.3720], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    busMarker = L.marker([22.5726, 88.3639], {
        icon: L.divIcon({ html: "🚌", className:"", iconSize:[28,28] })
    }).addTo(map);

    map.on('click', (e) => {
        if (!selectingStop) return;
        if (userStopMarker) map.removeLayer(userStopMarker);
        userStopMarker = L.marker([e.latlng.lat, e.latlng.lng], {icon: L.divIcon({html:"📍", className:"", iconSize:[22,22]})}).addTo(map);
        selectingStop = false;
        setStopBtn.innerText = "Enable Set Stop";
        trackStatus.innerText = "Stop set. Waiting for bus...";
        computeAndShowETA();
    });

    populateBusSelect();
}

/* ---------------- TRACKER BUS SELECTION ---------------- */
let currentListeningBus = null;
let currentUnsubscribe = null;

async function populateBusSelect() {
    busSelect.innerHTML = "<option>Loading…</option>";
    const snapshot = await db.collection("busesMeta").get();
    busSelect.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.innerText = snapshot.empty ? "No buses available" : "Select bus to track";
    busSelect.appendChild(defaultOpt);

    snapshot.forEach(doc => {
        const data = doc.data();
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.innerText = `${doc.id} — ${data.name || ""}`;
        busSelect.appendChild(opt);
    });
}

busSelect.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;
    trackStatus.innerText = `Tracking ${id}…`;
    startListeningBusWebRTC(id);
});

/* ---------------- ETA CALC ---------------- */
const avgSpeedKmh = 30;

function computeAndShowETA() {
    if (!currentListeningBus) {
        etaBox.innerText = "ETA: select a bus";
        return;
    }
    if (!busMarker) {
        etaBox.innerText = "ETA: waiting for bus location...";
        return;
    }
    if (!userStopMarker) {
        etaBox.innerText = "ETA: set your stop (click Set Stop)";
        return;
    }

    const busLatLng = busMarker.getLatLng();
    const userLatLng = userStopMarker.getLatLng();
    const distKm = haversineDistance(
        [busLatLng.lat, busLatLng.lng],
        [userLatLng.lat, userLatLng.lng]
    );

    const minutes = Math.round((distKm / avgSpeedKmh) * 60);
    etaBox.innerText = `ETA: ~ ${minutes} min (${distKm.toFixed(2)} km)`;
}

function haversineDistance(a, b) {
    const R = 6371;
    const lat1 = a[0] * Math.PI / 180, lon1 = a[1] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180, lon2 = b[1] * Math.PI / 180;
    const dlat = lat2 - lat1, dlon = lon2 - lon1;
    const aa = Math.sin(dlat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    return R * c;
}

// ------------------- EVENT HANDLERS -------------------

// When passenger selects a bus
busSelect.addEventListener("change", (e) => {
    const busId = e.target.value;
    if (busId) {
        currentListeningBus = busId;
        trackStatus.innerText = `Tracking bus: ${busId}`;
        computeAndShowETA();
    } else {
        currentListeningBus = null;
        trackStatus.innerText = "No bus selected";
        etaBox.innerText = "ETA: select a bus";
    }
});

// Checkbox toggle
followCheckbox.addEventListener("change", () => {
    followBus = followCheckbox.checked;
});

// Stop setting (when passenger marks stop)
setStopBtn.addEventListener("click", () => {
    if (!map) return;
    map.once("click", (e) => {
        if (userStopMarker) {
            map.removeLayer(userStopMarker);
        }
        userStopMarker = L.marker(e.latlng).addTo(map);
        computeAndShowETA();
    });
});

// ------------------- BUS LOCATION UPDATES -------------------
// Call this whenever bus location is updated
function updateBusLocation(lat, lng) {
    if (!busMarker) {
        busMarker = L.marker([lat, lng], { icon: L.icon({ iconUrl: "bus.png", iconSize: [32, 32] }) })
            .addTo(map);
    } else {
        busMarker.setLatLng([lat, lng]);
    }
    if (followBus) {
        map.setView([lat, lng], map.getZoom());
    }
    computeAndShowETA();
}


/* ---------------- INIT ---------------- */
document.getElementById("btnTrack").addEventListener("click", initMap);
document.getElementById("gotoTrack").addEventListener("click", initMap);

loadBusOptions();
refreshBuses();

window.addEventListener("beforeunload", () => {
    stopSharing();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((reg) => console.log("Service Worker registered:", reg.scope))
            .catch((err) => console.log("Service Worker registration failed:", err));
    });
}

