const Message = require('../models/Message'); // Import Message model
const Chatroom = require('../models/Chatroom'); // Import Message model
const Subscription = require('../models/Subscription'); // Import Message model
const Participant = require('../models/Participant'); // Import Message model
const MessageReadStatus = require('../models/MessageReadStatus'); // Import Message model
const MessageReact = require('../models/MessageReactions'); // Import Message model
const User = require('../models/User'); // Import User model
const webPush = require('web-push');
const upload = require('./upload');

const { sendNotification } = require('../../utils/sendNotification'); // Import FCM notification function

const {
    sendError,
    sendSuccess,
    getToken,
    sendErrorUnauthorized,
    decodeToken
} = require("../../utils/methods");

exports.getMessagesByChatroom = async (req, res, io) => {
    let token = getToken(req.headers); // Get token from request headers
    if (token) {
        const userDecoded = decodeToken(token); // Decode the token to get user info

        const { chatroomId } = req.params; // Get chatroomId from request parameters

        try {
            // Check if the user is a participant of the specified chatroom
            const participant = await Participant.findOne({
                where: { chatRoomId: chatroomId, userId: userDecoded.user.id },
            });

            if (!participant) {
                return sendErrorUnauthorized(res, "", "You are not a participant of this chatroom.");
            }

            // Fetch the chatroom details
            const chatroom = await Chatroom.findOne({
                where: { id: chatroomId },
                include: [
                    {
                        model: Participant,
                        as: 'Participants',
                        include: [
                            {
                                model: User,
                                as: 'user',
                                attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'],
                            },
                        ],
                    },
                ],
            });

            if (!chatroom) {
                return sendError(res, null, "Chatroom not found.");
            }

            // Fetch messages from the chatroom **including reactions**
            const messages = await Message.findAll({
                where: { chatroomId },
                include: [
                    {
                        model: User,
                        as: 'sender',
                        attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'], // Fetch only the necessary fields
                    },
                    {
                        model: MessageReact, // Include reactions
                        as: 'reactions',
                        include: [
                            {
                                model: User,
                                as: 'user',
                                attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'],
                            },
                        ],
                        attributes: ['id', 'react', 'userId', 'messageId', 'createdAt'],
                    },
                ],
                order: [['createdAt', 'DESC']], // Order messages by createdAt in ascending order
            });

            // Identify unread messages for the user
            const unreadMessageIds = messages
                .filter(message => message.sender.id !== userDecoded.user.id) // Ignore messages sent by the user
                .map(message => message.id);

            if (unreadMessageIds.length > 0) {
                // Update unread messages to "read"
                await MessageReadStatus.update(
                    { read: true },
                    {
                        where: {
                            messageId: unreadMessageIds,
                            userId: userDecoded.user.id,
                            read: false, // Only update unread messages
                        },
                    }
                );

                // Emit real-time updates to other participants
                const participants = await Participant.findAll({
                    where: { chatRoomId: chatroomId },
                    attributes: ['userId'],
                });

                participants.forEach(async participant => {
                    const unreadCount = await MessageReadStatus.count({
                        where: {
                            userId: participant.userId,
                            read: false,
                        },
                        include: [
                            {
                                model: Message,
                                as: 'message',
                                attributes: [],
                                where: { chatroomId },
                            },
                        ],
                    });

                    // Emit the updated unread count for each participant
                    io.to(`user_${participant.userId}`).emit('unread_update', {
                        chatroomId,
                        unreadCount,
                    });
                });

                // Emit a real-time event to notify this user about marked-as-read messages
                io.to(chatroomId).emit('message_read', {
                    userId: userDecoded.user.id,
                    messageIds: unreadMessageIds,
                });
            }

            return sendSuccess(res, {
                chatroom, // Include chatroom details
                messages, // Include messages with reactions
            });
        } catch (error) {
            console.error('Error fetching messages:', error);
            return sendError(res, error, 'Failed to retrieve messages.');
        }
    } else {
        return sendErrorUnauthorized(res, "", "Please login first.");
    }
};


// Save a new message and broadcast it
exports.sendMessage = async (req, res, io) => {
    // Use the multer middleware for handling file uploads
    upload.single('file')(req, res, async (err) => {
        if (err) {
            console.error('File upload error:', err);
            return sendError(res, err, 'Failed to upload file.', 500);
        }

        const token = getToken(req.headers);
        if (!token) {
            return sendErrorUnauthorized(res, '', 'Please login first.');
        }

        const { senderId, chatroomId } = req.body;

        // Check if a file was uploaded
        const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        try {
            // If a file is uploaded, use the file URL as the content
            const content = fileUrl || req.body.content;

            // Save the new message with or without file URL
            const message = await Message.create({
                content,
                senderId,
                chatroomId,
                fileUrl, // Save file URL if present
            });

            // Fetch the message with sender details to return in the response
            const fullMessage = await Message.findOne({
                where: { id: message.id },
                include: [
                    {
                        model: User,
                        as: 'sender',
                        attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'],
                    },
                ],
            });

            if (io) {
                io.to(chatroomId).emit('new_message', fullMessage);
            }

            // Process the participants and handle unread status, notifications, etc.
            const participants = await Participant.findAll({
                where: { chatRoomId: chatroomId },
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'],
                    },
                ],
            });

            const filteredParticipants = participants.filter(
                (participant) => participant.user.id !== senderId
            );

            const readStatusPromises = filteredParticipants.map((participant) =>
                MessageReadStatus.create({
                    messageId: message.id,
                    userId: participant.user.id,
                    read: false, // Default to "unread"
                })
            );

            await Promise.all(readStatusPromises);

            for (const participant of filteredParticipants) {
                const unreadCount = await MessageReadStatus.count({
                    where: {
                        userId: participant.user.id,
                        read: false,
                    },
                    include: [
                        {
                            model: Message,
                            as: 'message',
                            attributes: [],
                            where: { chatroomId },
                        },
                    ],
                });

                io.to(`user_${participant.user.id}`).emit('unread_update', {
                    chatroomId,
                    unreadCount,
                });
            }

            // 🔥 FCM Push Notification to Participants 🔥
            const pushPromises = filteredParticipants.map(async (participant) => {
                // Fetch all subscriptions for the user
                const subscriptions = await Subscription.findAll({
                    where: { userId: participant.user.id },
                });

                if (subscriptions.length > 0) {
                    // Send notifications to all subscribed devices
                    const sendPromises = subscriptions.map(async (subscription) => {
                        try {
                            let subscriptionData = subscription.subscription;

                            if (typeof subscriptionData === "string") {
                                try {
                                    subscriptionData = JSON.parse(subscriptionData); // Convert string to object
                                } catch (error) {
                                    console.error("Error parsing subscription JSON:", error);
                                }
                            }
                            
                            const fcmToken = subscriptionData?.fcmToken; // Access safely
                            
                            if (fcmToken) {
                                await sendNotification(
                                    fcmToken,
                                    `New message from ${fullMessage.sender.user_fname} ${fullMessage.sender.user_lname}`,
                                    content
                                );
                            }
                        } catch (error) {
                            console.error('Error sending push notification:', error);
                        }
                    });

                    // Wait for all notifications to complete
                    await Promise.all(sendPromises);
                }
            });

            await Promise.all(pushPromises);

            return sendSuccess(res, fullMessage);
        } catch (error) {
            console.error('Error sending message:', error);
            return sendError(res, error, 'Failed to send message.', 500);
        }
    });
};


exports.reactToMessage = async (req, res, io) => {
    const token = getToken(req.headers);
    if (!token) {
        return sendErrorUnauthorized(res, '', 'Please login first.');
    }

    const userDecoded = decodeToken(token);
    const userId = userDecoded.user.id;
    const { messageId, react } = req.body;

    try {
        // Fetch the message and its sender
        const message = await Message.findOne({ 
            where: { id: messageId },
            include: [{ 
                model: User, 
                as: 'sender', 
                attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'] 
            }]
        });

        if (!message) {
            return sendError(res, null, 'Message not found.', 404);
        }

        // Prevent user from reacting to their own message (optional)
        if (message.sender.id === userId) {
            return sendError(res, null, "You can't react to your own message.", 400);
        }

        // Create reaction
        const reaction = await MessageReact.create({
            messageId,
            userId,
            react,
        });

        // Fetch full reaction details with user info
        const fullReaction = await MessageReact.findOne({
            where: { id: reaction.id },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'user_fname', 'user_lname', 'user_profile_picture'],
                },
            ],
        });

        // Emit real-time event for the reaction
        if (io) {
            io.to(message.chatroomId).emit('new_message_reaction', fullReaction);
        }

        // ✅ SEND PUSH NOTIFICATION TO MESSAGE SENDER (not the reacter)
        const subscriptions = await Subscription.findAll({
            where: { userId: message.sender.id }, // Ensure only the sender gets the notification
        });

        if (subscriptions.length > 0) {
            // Reaction emoji mapping
            const reactionEmojis = {
                "heart": "❤️",
                "pray": "🙏",
                "praise": "🙌",
                "clap": "👏"
            };

            const reactionEmoji = reactionEmojis[react] || ""; // Default to empty if reaction is unknown

            // Send notifications to all subscribed devices of the sender
            const sendPromises = subscriptions.map(async (subscription) => {
                try {
                    let subscriptionData = subscription.subscription;

                    if (typeof subscriptionData === "string") {
                        try {
                            subscriptionData = JSON.parse(subscriptionData); // Convert string to object
                        } catch (error) {
                            console.error("Error parsing subscription JSON:", error);
                        }
                    }
                    
                    const fcmToken = subscriptionData?.fcmToken; // Access safely
                    
                    if (fcmToken) {
                        await sendNotification(
                            fcmToken,
                            'WOTG Community',
                            `${fullReaction.user.user_fname} ${fullReaction.user.user_lname} reacted ${reactionEmoji} to your message`
                        );
                    }
                } catch (error) {
                    console.error('Error sending push notification:', error);
                }
            });

            await Promise.all(sendPromises);
        }

        return sendSuccess(res, fullReaction);
    } catch (error) {
        console.error('Error reacting to message:', error);
        return sendError(res, error, 'Failed to react to message.', 500);
    }
};







