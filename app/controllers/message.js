const Message = require('../models/Message'); // Import Message model
const User = require('../models/User'); // Import User model

const {
    sendError,
    sendSuccess,
    getToken,
    sendErrorUnauthorized,
} = require("../../utils/methods");

// Fetch messages by chatroom ID
exports.getMessagesByChatroom = async (req, res) => {
    let token = getToken(req.headers); 
    if (token) {
        const { chatroomId } = req.params;

        try {
            const messages = await Message.findAll({
                where: { chatroomId },
                include: [
                    {
                        model: User,
                        as: 'sender', // Use the alias defined in the model
                        attributes: ['id', 'user_fname', 'user_lname'], // Fetch only the necessary fields
                    },
                ],
                order: [['createdAt', 'ASC']],
            });

            return sendSuccess(res, messages);
        } catch (error) {
            console.error('Error fetching messages:', error);
            return sendError(res, error, 'Failed to retrieve messages.');
        }
    } else {
        return sendErrorUnauthorized(res, "", "Please login first.");
    }
};

// Save a new message
exports.sendMessage = async (req, res) => {
    let token = getToken(req.headers); 
    if (token) {
        const { content, senderId, chatroomId } = req.body;

        try {
            // Save the new message
            const message = await Message.create({
                content,
                senderId,
                chatroomId,
            });

            // Fetch the message with sender details to return in the response
            const fullMessage = await Message.findOne({
                where: { id: message.id },
                include: [
                    {
                        model: User,
                        as: 'sender',
                        attributes: ['id', 'user_fname', 'user_lname'], // Fetch sender's details
                    },
                ],
            });

            return sendSuccess(res, fullMessage);
        } catch (error) {
            console.error('Error sending message:', error);
            return sendError(res, error, 'Failed to send message.');
        }
    } else {
        return sendErrorUnauthorized(res, "", "Please login first.");
    }
};