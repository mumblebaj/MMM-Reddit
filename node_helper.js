/* Magic Mirror
 * Module: MMM-Reddit
 *
 * By kjb085 https://github.com/kjb085/MMM-Reddit
 */
//const fetch = require('node-fetch');
const NodeHelper = require('node_helper');

module.exports = NodeHelper.create({

    /**
     * Base url for all requests
     * @type {String}
     */
    baseUrl: 'https://www.reddit.com/',

    /**
     * List of image qualities in ascending order
     * @type {Array}
     */
    qualityIndex: [
        'low',
        'mid',
        'mid-high',
        'high',
    ],

    /**
     * Log the the helper has started
     *
     * @return {void}
     */
    start () {
        console.log(`Starting module helper: ${this.name}`);
    },

    /**
     * Handle frontend notification by setting config and initializing reddit request
     *
     * @param  {String} notification
     * @param  {Object} payload
     * @return {void}
     */
    socketNotificationReceived (notification, payload) {
        if (notification === 'REDDIT_CONFIG') {
            this.config = payload.config;
            this.getData();
        }
    },

    sendData (obj) {
        this.sendSocketNotification('REDDIT_POSTS', obj);
    },

    /**
     * Make request to reddit and send posts back to MM frontend
     *
     * @return {void}
     */
async getData() {
    try {
        const url = this.getUrl(this.config);
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`Error fetching Reddit data: ${response.status} ${response.statusText}`);
            this.sendError(`Error fetching Reddit data: ${response.status}`);
            return;
        }

        const body = await response.json();

        if (!body?.data?.children) {
            this.sendError('No posts returned. Ensure the subreddit name is spelled correctly. Private subreddits are also inaccessible.');
            return;
        }

        const posts = body.data.children
            .filter(post => {
                const thumbnail = post.data.thumbnail;
                const hasValidThumbnail = typeof thumbnail === 'string' && thumbnail.startsWith('http');
                const imageSrc = this.getImageUrl(post.data.preview, thumbnail);
                const isImageValid = this.config.displayType !== 'image' || imageSrc !== null;

                return hasValidThumbnail && isImageValid;
            })
            .map(post => ({
                title: this.formatTitle(post.data.title),
                score: post.data.score,
                thumbnail: post.data.thumbnail,
                src: this.getImageUrl(post.data.preview, post.data.thumbnail),
                gilded: post.data.gilded,
                num_comments: post.data.num_comments,
                subreddit: post.data.subreddit,
                author: post.data.author
            }));

        this.sendData({ posts });

    } catch (err) {
        console.error('Reddit fetch failed:', err);
        this.sendError('An error occurred while fetching Reddit data.');
    }
},


    /**
     * Get reddit URL based on user configuration
     *
     * @param  {Object} config
     * @return {String}
     */
    getUrl (config) {
        let url = this.baseUrl,
            subreddit = this.formatSubreddit(config.subreddit),
            type = config.type,
            count = config.count;

        if (subreddit !== '' && subreddit !== 'frontpage') {
            url += 'r/' + subreddit + '/';
        }

        return url + type + '/.json?raw_json=1&limit=' + count;
    },

    /**
     * If mutliple subreddits configured, stringify for URL use
     *
     * @param  {String|Array} subreddit
     * @return {String}
     */
    formatSubreddit (subreddit) {
        if (Array.isArray(subreddit)) {
            subreddit = subreddit.join('+');
        }

        return subreddit;
    },

    /**
     * Format the title to return to front end
     *
     * @param  {Object} post
     * @return {String}
     */
    formatTitle (title) {
        let replacements = this.config.titleReplacements,
            limit = this.config.characterLimit,
            originalLength = title.length;

        replacements.forEach((modifier) => {
            let caseSensitive = typeof modifier.caseSensitive !== 'undefined' ? modifier.caseSensitive : true,
                caseFlag = caseSensitive ? '' : 'i',
                search = new RegExp(modifier.toReplace, 'g' + caseFlag),
                replacement = modifier.replacement;

            title = title.replace(search, replacement);
        });

        if (limit !== null) {
            title = title.slice(0, limit).trim();

            if (title.length !== originalLength) {
                title += '...';
            }
        }

        return title;
    },

    /**
     * If applicable, get the URL for the resolution designated by the user
     *
     * @param  {Object} preview
     * @param  {String} thumbnail
     * @return {String}
     */
    getImageUrl (preview, thumbnail) {
        if (this.skipNonImagePost(preview, thumbnail)) {
            return null;
        }

        let allPostImages = this.getAllImages(preview.images[0]),
            imageCount = allPostImages.length,
            qualityIndex = this.qualityIndex.indexOf(this.config.imageQuality),
            qualityPercent = qualityIndex / 4,
            imageIndex;

        if (imageCount > 5) {
            imageIndex = Math.round(qualityPercent * imageCount);
        } else {
            imageIndex = Math.floor(qualityPercent * imageCount);
        }

        return allPostImages[imageIndex].url;
    },

    /**
     * Determine if the current post is not an image post
     *
     * @param  {Object} preview
     * @param  {String} thumbnail
     * @return {Boolean}
     */
    skipNonImagePost (preview, thumbnail) {
        let previewUndefined = typeof preview === "undefined",
            nonImageThumbnail = thumbnail.indexOf('http') === -1,
            hasImages, firstImageHasSource;

        if (!previewUndefined && !nonImageThumbnail) {
            hasImages = preview.hasOwnProperty('images');

            if (hasImages) {
                firstImageHasSource = preview.images[0].hasOwnProperty('source');

                if (firstImageHasSource) {
                    return false;
                }
            }
        }

        return true;
    },

    /**
     * Get set of all image resolutions
     *
     * @param  {Object} imageObj
     * @return {Array}
     */
    getAllImages (imageObj) {
        let imageSet = imageObj.resolutions,
            lastImage = imageSet.pop(),
            lastIsSource = lastImage.width === imageObj.source.width &&
                lastImage.height === imageObj.source.height;

        imageSet.push(lastImage);

        if (!lastIsSource) {
            imageSet.push(imageObj.source);
        }

        return imageSet;
    },

    /**
     * Send an error to the frontend
     *
     * @param  {String} error
     * @return {void}
     */
    sendError (error) {
        console.log(error);
        this.sendSocketNotification('REDDIT_POSTS_ERROR', { message: error });
    },
});
