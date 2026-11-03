const CryptoJS = require('crypto-js');

const DES_SECRET = '38346591';

function decryptSaavnUrl(encryptedMediaUrl) {
    if (!encryptedMediaUrl) return null;
    try {
        const key = CryptoJS.enc.Utf8.parse(DES_SECRET);
        const decrypted = CryptoJS.DES.decrypt({
            ciphertext: CryptoJS.enc.Base64.parse(encryptedMediaUrl)
        }, key, {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7
        });
        const url = decrypted.toString(CryptoJS.enc.Utf8);
        if (!url) return null;
        return url
            .replace('_96.mp4', '_160.mp4')
            .replace('http://', 'https://');
    } catch (e) {
        return null;
    }
}

function cleanHtml(text) {
    if (!text) return '';
    return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function getHdArtwork(img) {
    if (!img) return '';
    return img
        .replace('150x150.jpg', '500x500.jpg')
        .replace('50x50.jpg', '500x500.jpg')
        .replace('http://', 'https://');
}

const CATEGORY_QUERY_MAP = {
    'Top Trending': 'top trending hindi songs',
    'Bollywood Hits': 'latest bollywood songs',
    'Punjabi Beats': 'latest punjabi hits',
    'Haryanvi Dhamaka': 'latest haryanvi hits',
    'Mewati Special': 'mewati song new hit',
    'Romantic Melodies': 'romantic hindi songs',
    'Party & DJ Remix': 'dj remix songs hindi',
    'Lo-Fi & Chill': 'lofi chill hindi songs',
    'Qawwali & Sufi': 'qawwali sufi songs'
};

async function searchJioSaavn(query, page = 1, count = 40) {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${count}&p=${page}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
        }
    });
    if (!res.ok) throw new Error(`JioSaavn API error ${res.status}`);
    const data = await res.json();
    const songs = [];
    const seen = new Set();

    (data.results || []).forEach(item => {
        const enc = item.more_info?.encrypted_media_url;
        const audioUrl = decryptSaavnUrl(enc);
        if (audioUrl && item.title) {
            const title = cleanHtml(item.title);
            const artist = cleanHtml(item.subtitle || item.more_info?.music || 'Various Artists');
            const key = `${title.toLowerCase()}_${artist.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                songs.push({
                    id: `saavn_${item.id}`,
                    title,
                    artist,
                    album: cleanHtml(item.more_info?.album || 'Single'),
                    duration: parseInt(item.more_info?.duration || '240', 10),
                    coverUrl: getHdArtwork(item.image),
                    audioUrl
                });
            }
        }
    });
    return songs;
}

async function getTrending(category = 'Top Trending', page = 1) {
    const cleanCategory = category.replace(/^[^\w\s]+/, '').trim();
    const query = CATEGORY_QUERY_MAP[cleanCategory] || cleanCategory || 'top trending hindi songs';
    return await searchJioSaavn(query, page, 50);
}

async function getPersonalizedFeed(artists = [], page = 1) {
    if (!artists || artists.length === 0) {
        return await getTrending('Top Trending', page);
    }
    const promises = artists.map(a => searchJioSaavn(`${a} hit songs`, page, 25).catch(() => []));
    const results = await Promise.all(promises);

    const merged = [];
    const seen = new Set();
    let maxLen = Math.max(...results.map(r => r.length), 0);

    for (let i = 0; i < maxLen; i++) {
        for (let j = 0; j < results.length; j++) {
            if (i < results[j].length) {
                const s = results[j][i];
                if (!seen.has(s.id)) {
                    seen.add(s.id);
                    merged.push(s);
                }
            }
        }
    }
    return merged;
}

module.exports = {
    decryptSaavnUrl,
    cleanHtml,
    getHdArtwork,
    searchJioSaavn,
    getTrending,
    getPersonalizedFeed
};
