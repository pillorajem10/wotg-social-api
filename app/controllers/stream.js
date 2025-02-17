const mediasoup = require("mediasoup");

let ioInstance = null;
let producer = null;
let worker, router, producerTransport, consumerTransports = [];

// ✅ Initialize WebRTC Worker & Transport
async function createMediasoupWorker() {
    worker = await mediasoup.createWorker();
    router = await worker.createRouter({
        mediaCodecs: [
            { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
            { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }
        ],
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

exports.getRtpCapabilities = async (req, res) => {
    if (!router) {
        return res.status(500).json({ success: false, message: "Mediasoup Router not initialized." });
    }

    return res.json({ success: true, rtpCapabilities: router.rtpCapabilities });
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

// ✅ WebRTC Signaling (Socket.io) - Use Existing `io` Instance
exports.handleWebRTCSignaling = (io) => {
    ioInstance = io; // ✅ Use existing `io` from `server.js`, no new Server instance

    ioInstance.on("connection", (socket) => {
        console.log("🔗 New user connected:", socket.id);

        socket.on("start_webrtc_stream", async ({ rtpParameters }) => {
            console.log('RTP PARAMS', rtpParameters); 
            if (!router) {
                console.error("❌ Mediasoup Router not initialized.");
                return;
            }
        
            // ✅ Validate `rtpParameters` before proceeding
            if (!rtpParameters || !Array.isArray(rtpParameters) || rtpParameters.length === 0) {
                console.error("❌ Invalid rtpParameters received:", rtpParameters);
                return;
            }
        
            try {
                producer = await producerTransport.produce({
                    kind: "video",
                    rtpParameters: rtpParameters[0], // ✅ Use the first valid set of `rtpParameters`
                });
        
                ioInstance.emit("stream_started", { producerId: producer.id });
            } catch (error) {
                console.error("❌ Error producing stream:", error);
            }
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
