const Music = require("../models/Music");
const Album = require("../models/Album");
const PlaylistMusic = require("../models/PlaylistMusic");

const {
  sendError,
  sendSuccess,
  getToken,
  sendErrorUnauthorized,
  removeFileFromSpaces,
  decodeToken,
} = require("../../utils/methods");

const uploadMemory = require('./uploadMemory');

const { uploadFileToSpaces } = require('./spaceUploader');

const { clearMusicCache, clearRecommendedCache } = require("../../utils/clearBlogCache");
const { Sequelize, Op } = require("sequelize");

const redisClient = require("../../config/redis");

exports.list = async (req, res) => {
    const token = getToken(req.headers);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");

    try {
        let { pageIndex, pageSize, albumId, search, order } = req.query;

        // ✅ Validate pagination parameters
        if (!pageIndex || !pageSize || isNaN(pageIndex) || isNaN(pageSize) || pageIndex <= 0 || pageSize <= 0) {
            return sendError(res, "", "Missing or invalid query parameters: pageIndex and pageSize must be > 0.");
        }

        pageIndex = parseInt(pageIndex);
        pageSize = parseInt(pageSize);

        const offset = (pageIndex - 1) * pageSize;
        const limit = pageSize;

        // Filtering based on albumId and search
        let orderClause = [];

        if (order === 'createdAt') {
            orderClause = [['createdAt', "DESC"]];
        } else if (order === 'play_count') {
            orderClause = [['play_count', "DESC"]];
        } 
        // ✅ Build dynamic Redis cache key
        const cacheKey = `music:page:${pageIndex}:${pageSize}${albumId ? `:album:${albumId}` : ""}${search ? `:search:${search}` : ""}${order ? `:order:${order}` : ""}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            return sendSuccess(res, JSON.parse(cached), "From cache");
        }

        const where = {
            [Op.and]: [
                albumId ? { album_id: parseInt(albumId) } : {}, // Filter by albumId if provided
                search ? {
                    [Op.or]: [
                        { title: { [Op.like]: `%${search}%` } },
                        { artist_name: { [Op.like]: `%${search}%` } }
                    ]
                } : {}
            ]
        }; 
        
        const { count, rows } = await Music.findAndCountAll({
            where,
            order: orderClause,
            offset,
            attributes: [
                'id',
                'audio_url',
                'title',
                'artist_name',
                'duration',
                'play_count',
                'createdAt',
                'album_id',
                [Sequelize.col('Album.cover_image'), 'cover_image'],
                [Sequelize.col('Album.title'), 'album_title']
            ],
            include: [ 
                { 
                    model: Album,
                    attributes: [],
                    required: false
                }
            ],
            limit,
            raw: true
        });

        const totalPages = Math.ceil(count / pageSize);
        const response = {
            pageIndex,
            pageSize,
            totalPages,
            totalItems: count,
            musics: rows
        };

        await redisClient.set(cacheKey, JSON.stringify(response), 'EX', 3600); // Cache for 1 hourq

        return sendSuccess(res, response);
    } catch (error) {
        console.error("Error in list function:", error);
        return sendError(res, "", "An error occurred while fetching the musics.");
    }
}

exports.recommended = async (req, res) => {
    const token = getToken(req.headers);
    const decodedToken = decodeToken(token);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");

    try {
        let { pageIndex, pageSize, search } = req.query;
        const userId = decodedToken.user.id;

        // ✅ Validate pagination parameters
        if (!pageIndex || !pageSize || isNaN(pageIndex) || isNaN(pageSize) || pageIndex <= 0 || pageSize <= 0) {
            return sendError(res, "", "Missing or invalid query parameters: pageIndex and pageSize must be > 0.");
        }

        pageIndex = parseInt(pageIndex);
        pageSize = parseInt(pageSize);

        const offset = (pageIndex - 1) * pageSize;
        const limit = pageSize;
        const seed = Math.floor(Math.random() * 1000000);

        const cacheKey = `recommended:page:${pageIndex}:${pageSize}:seed:${seed}:userId:${userId}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            return sendSuccess(res, JSON.parse(cached), "From cache");
        }

        const where = {
            [Op.and]: [
                search ? {
                    [Op.or]: [
                        { title: { [Op.like]: `%${search}%` } },
                        { artist_name: { [Op.like]: `%${search}%` } }
                    ]
                } : {}
            ]
        }; 
        
        const { count, rows } = await Music.findAndCountAll({
            where,
            order: Sequelize.literal('RAND()'),
            offset,
            attributes: [
                'id',
                'audio_url',
                'title',
                'artist_name',
                'duration',
                'play_count',
                'album_id',
                [Sequelize.col('Album.cover_image'), 'cover_image'],
                [Sequelize.col('Album.title'), 'album_title']
            ],
            include: [ 
                { 
                    model: Album,
                    attributes: [],
                    required: false
                }
            ],
            limit,
            raw: true
        });

        const totalPages = Math.ceil(count / pageSize);
        const response = {
            pageIndex,
            pageSize,
            totalPages,
            totalItems: count,
            musics: rows
        };

        await redisClient.set(cacheKey, JSON.stringify(response), 'EX', 30); // short TTL

        return sendSuccess(res, response);
    } catch (error) {
        console.error("Error in list function:", error);
        return sendError(res, "", "An error occurred while fetching the musics.");
    }
}

exports.getMusicById = async (req, res) => {
    let token = getToken(req.headers);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");

    try {
        const { musicId } = req.params;

        if (!musicId) return sendError(res, "", "Missing musicId parameter.");

        const cacheKey =  `music_${musicId}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            return sendSuccess(res, JSON.parse(cached), "From cache");
        }

        const music = await Music.findOne({
            where: { id: musicId },
            attributes: [
                'id',
                'audio_url',
                'title',
                'artist_name',
                'play_count',
                'album_id',
                [Sequelize.col('Album.cover_image'), 'cover_image']
            ],
            include: [
                {
                    model: Album,
                    attributes: []
                }
            ],
            raw: true
        });

        if (!music) {
            return sendError(res, "", "Music not found.");
        }

        await Music.update({
            play_count: music.play_count + 1,
        }, { where: { id: musicId } })

        await clearMusicCache(musicId);
        
        return sendSuccess(res, music, "Music retrieved successfully.");
    } catch (error) {
        console.error("Error in getMusicById function:", error);
        return sendError(res, "", "An error occurred while fetching the music.");
    };
}

exports.create = async (req, res) => {
    const token = getToken(req.headers);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");

    try {
        uploadMemory.single("file")(req, res, async (err) => {
            const { title, album_id, duration, track_number, is_explicit, genre } = req.body;

            if (!req.file) {
                return sendError(res, "", "Missing required field: file is required.");
            }

            // check if the album_id exists in the database
            const album = await Album.findOne({
                where: { id: album_id },
                raw: true
            });

            if (!album) {
                return sendError(res, "", "Album not found.");
            };

            // const processedFile  = await processAudio(req.file); 
            const uploadedUrl = await uploadFileToSpaces(req.file);

            const music = await Music.create({
                title,
                album_id,
                artist_name: "WOTG Praise", 
                audio_url: uploadedUrl,
                duration,
                track_number,
                is_explicit,
                genre
            });
    
            // Clear cache for the newly created music
            await Promise.all([
                clearMusicCache(),
                clearRecommendedCache()
            ]);
    
            return sendSuccess(res, music, "Music created successfully.");
        });
    } catch (error) {
        console.error("Error in create function:", error);
        return sendError(res, "", "An error occurred while creating the music.");
    };
};

exports.update = async (req, res) => {
    const token = getToken(req.headers);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");
    
    try {

        uploadMemory.single("file")(req, res, async (err) => {
            const { musicId } = req.params;
            const { title, album_id, duration, track_number, is_explicit, genre } = req.body;

            const music = await Music.findOne({
                where: { id: musicId },
                raw: true
            });

            if (!music) {
                return sendError(res, "", "Music not found.");
            };

            let audio_url = null;

            if (req.file) {
                removeFileFromSpaces('audios', music.audio_url); // Remove the old file
                audio_url = await uploadFileToSpaces(req.file); // Process the new file
            };

            await Music.update({
                title,
                album_id,
                artist_name: "WOTG Praise",
                audio_url,
                duration,
                track_number,
                is_explicit,
                genre
            }, {
                where: { id: musicId }
            });

            await Promise.all([
                clearMusicCache(musicId),
                clearRecommendedCache()
            ]);

            return sendSuccess(res, "", "Music updated successfully.");
        });

    } catch (error) {
        console.error("Error in update function:", error);
        return sendError(res, "", "An error occurred while updating the music.");
    }
};

exports.delete = async (req, res) => {
    const token = getToken(req.headers);

    if (!token) return sendErrorUnauthorized(res, "", "Please login first.");

    try {
        const { musicId } = req.params;

        if (!musicId) return sendError(res, "", "Missing musicId parameter.")
        
        const music = await Music.findOne({
            where: { id: musicId },
            raw: true
        });

        if (!music) {
            return sendError(res, "", "Music not found.");
        }

        if (music.audio_url) {
            removeFileFromSpaces('audios', music.audio_url); // Remove the old file
        }

        await PlaylistMusic.destroy({
            where: { music_id: musicId }
        }); 

        await Music.destroy({
            where: { id: musicId }
        });

        await Promise.all([
            clearMusicCache(),
            clearRecommendedCache()
        ]);

        return sendSuccess(res, "", "Music deleted successfully.");
    } catch (error) {
        console.error("Error in delete function:", error);
        return sendError(res, "", "An error occurred while deleting the music.");
    }
};