// ===================== pweasy.js =====================
// Include this file in HTML AFTER pweasy.min.js

// ---------------- Driver / Bus Peer ----------------
let driverPeer = null;

/**
 * Initialize PWEasy for driver
 * @param {string} busId - Bus ID to use as peerId
 */
function initDriverPWEasy(busId) {
    if (!busId) {
        console.warn("Bus ID required for driver peer");
        return;
    }

    driverPeer = new PWEasy.Peer({
        peerId: busId,
        role: "driver"
    });

    driverPeer.connect();
    console.log("Driver PWEasy initialized with busId:", busId);
}

/**
 * Send driver location via PWEasy
 * @param {string} busId 
 * @param {number} lat 
 * @param {number} lng 
 */
function sendDriverLocation(busId, lat, lng) {
    if (!driverPeer) return;
    driverPeer.broadcast({
        type: "locationUpdate",
        busId,
        lat,
        lng
    });
}

// ---------------- Tracker / Dashboard Peer ----------------
let trackerPeer = null;

/**
 * Initialize PWEasy for tracker
 */
function initTrackerPWEasy() {
    trackerPeer = new PWEasy.Peer({
        role: "tracker"
    });
    trackerPeer.connect();
    console.log("Tracker PWEasy initialized");
}

/**
 * Subscribe to bus location updates
 * @param {string} busId 
 * @param {function} callback - Receives (lat, lng) whenever bus moves
 */
function trackBus(busId, callback) {
    if (!trackerPeer) return;

    // Remove previous listener if any
    if (window._currentBusListener) {
        trackerPeer.off(window._currentBusListener);
    }
    window._currentBusListener = `bus_${busId}`;

    trackerPeer.on("message", (msg) => {
        if (msg.type === "locationUpdate" && msg.busId === busId) {
            callback(msg.lat, msg.lng);
        }
    });
}
