import { progress } from './progress.js';
import { cache } from '../../connection/cache.js';

export const image = (() => {

    /**
     * @type {NodeListOf<HTMLImageElement>|null}
     */
    let images = null;

    /**
     * @type {ReturnType<typeof cache>|null}
     */
    let c = null;

    /**
     * @type {object[]}
     */
    const urlCache = [];

    /**
     * @param {string} src 
     * @returns {Promise<HTMLImageElement>}
     */
    const loadedImage = (src) => new Promise((res, rej) => {
        const i = new Image();
        const timer = setTimeout(() => rej(new Error('timeout')), 5000); // 5 giây
        i.onload = () => { clearTimeout(timer); res(i); };
        i.onerror = () => { clearTimeout(timer); rej(new Error('error')); };
        i.src = src;
    });

    /**
     * @param {HTMLImageElement} el 
     * @param {string} src 
     * @returns {Promise<void>}
     */
    const appendImage = (el, src) => loadedImage(src).then((img) => {
        el.classList.remove('opacity-0');
        el.src = img.src;
        img.remove();
        progress.complete('image');
    });

    /**
     * @param {HTMLImageElement} el 
     * @returns {void}
     */
    const getByFetch = (el) => {
        urlCache.push({
            url: el.getAttribute('data-src'),
            res: (url) => appendImage(el, url),
            rej: (err) => {
                console.error(err);
                progress.invalid('image');
            },
        });
    };

    /**
     * @param {HTMLImageElement} el 
     * @returns {void}
     */
    const getByDefault = (el) => {
        let counted = false;

        const markComplete = () => {
            if (counted) return;
            counted = true;
            progress.complete('image');
        };

        const markInvalid = () => {
            if (counted) return;
            counted = true;
            progress.invalid('image');
        };

        // Timeout 8 giây — nếu Zalo treo thì tự thoát
        const timer = setTimeout(markComplete, 8000);

        el.onerror = () => { clearTimeout(timer); markInvalid(); };
        el.onload = () => { clearTimeout(timer); markComplete(); };

        if (el.complete && el.naturalWidth !== 0 && el.naturalHeight !== 0) {
            clearTimeout(timer);
            markComplete();
        } else if (el.complete) {
            if (el.decode) {
                el.decode()
                    .then(() => { clearTimeout(timer); markComplete(); })
                    .catch(() => { clearTimeout(timer); markInvalid(); });
            } else {
                // Zalo không có decode() — thoát luôn
                clearTimeout(timer);
                markComplete();
            }
        }
    };

    /**
     * @returns {boolean}
     */
    const hasDataSrc = () => Array.from(images).some((i) => i.hasAttribute('data-src'));

    /**
     * @returns {Promise<void>}
     */
    const load = async () => {
        const imgs = Array.from(images);

        /**
         * @param {function} filter 
         * @returns {Promise<void>}
         */
        const runGroup = async (filter) => {
            urlCache.length = 0;
            imgs.filter(filter).forEach((el) => el.hasAttribute('data-src') ? getByFetch(el) : getByDefault(el));
            await c.run(urlCache, progress.getAbort());
        };

        await runGroup((el) => el.hasAttribute('fetchpriority'));
        await runGroup((el) => !el.hasAttribute('fetchpriority'));
    };

    /**
     * @param {string} blobUrl 
     * @returns {void}
     */
    const download = (blobUrl) => {
        c.download(blobUrl, `${window.location.hostname}_image_${Date.now()}`);
    };

    /**
     * @returns {object}
     */
    const init = () => {
        c = cache('image').withForceCache();
        images = document.querySelectorAll('img');
        images.forEach(progress.add);

        return {
            load,
            download,
            hasDataSrc,
        };
    };

    return {
        init,
    };
})();
