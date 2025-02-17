const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

let ioInstance = null;
let producer = null;
let worker, router, producerTransport, consumerTransports = [];

// ✅ Initialize WebRTC Worker & Transport
async function createMediasoupWorker() {
    worker = await mediasoup.createWorker();
    router = await worker.createRouter({
        mediaCodecs: [{ kind: "video", mimeType: "video/vp8", clockRate: 90000 }],
    });

    producerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: "145.223.75.230" }],
        enableUdp: true,
        enableTcp: true,
    });

    console.log("✅ WebRTC Server Ready!");
}

// ✅ API: Start WebRTC Stream
exports.startStream = async (req, res, io) => {
    try {
        if (producer) {
            return res.status(400).json({ success: false, message: "Stream is already running." });
        }

        console.log("🚀 Starting WebRTC stream...");
        io.emit("stream_status", { status: "started" });

        return res.json({ success: true, message: "🎥 WebRTC Streaming started!" });
    } catch (error) {
        console.error("❌ Error starting stream:", error);
        return res.status(500).json({ success: false, message: "Failed to start streaming." });
    }
};

// ✅ API: Stop WebRTC Stream
exports.stopStream = async (req, res, io) => {
    try {
        if (!producer) {
            return res.status(400).json({ success: false, message: "No active stream." });
        }

        console.log("🛑 Stopping WebRTC stream...");
        producer.close();
        producer = null;

        io.emit("stream_status", { status: "stopped" });

        return res.json({ success: true, message: "✅ Streaming stopped." });
    } catch (error) {
        console.error("❌ Error stopping stream:", error);
        return res.status(500).json({ success: false, message: "Failed to stop streaming." });
    }
};

// ✅ WebRTC Signaling (Socket.io)
exports.handleWebRTCSignaling = (server, io) => {
    ioInstance = new Server(server, { cors: { origin: "*" } });

    ioInstance.on("connection", (socket) => {
        console.log("🔗 New user connected:", socket.id);

        socket.on("start_webrtc_stream", async ({ sdp }) => {
            producer = await producerTransport.produce({ kind: "video", rtpParameters: sdp });
            ioInstance.emit("stream_started", { sdp: producer.sdp });
        });

        socket.on("join_webrtc_stream", async () => {
            if (!producer) return;
            const consumerTransport = await router.createWebRtcTransport({
                listenIps: [{ ip: "0.0.0.0", announcedIp: "145.223.75.230" }],
                enableUdp: true,
                enableTcp: true,
            });

            const consumer = await consumerTransport.consume({
                producerId: producer.id,
                rtpCapabilities: router.rtpCapabilities,
            });

            consumerTransports.push(consumerTransport);
            socket.emit("stream_data", { sdp: consumer.sdp });
        });

        socket.on("disconnect", () => {
            console.log("❌ User disconnected:", socket.id);
        });
    });

    createMediasoupWorker();
};
