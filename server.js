const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const musicBridge = require('./musicBridge');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'suno-mewat-super-secret-key-2026';
const DB_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for Banner / Logo uploads
const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ storage: uploadStorage });

// Helper to read and write database
function readDb() {
    try {
        if (!fs.existsSync(DB_FILE)) return { config: {}, banners: [], users: [], stats: {} };
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('Error reading DB:', e);
        return { config: {}, banners: [], users: [], stats: {} };
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error writing DB:', e);
    }
}

// Admin Auth Middleware
function authAdmin(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized. Admin token required.' });
    }
    const token = header.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired admin token.' });
    }
}

// -------------------------------------------------------------
// PUBLIC API ENDPOINTS (Shared by Web Player & Android App)
// -------------------------------------------------------------

// 1. App Configuration & Dynamic Branding
app.get('/api/config', (req, res) => {
    const db = readDb();
    const publicConfig = { ...db.config };
    delete publicConfig.adminPassword; // Never expose admin password
    const activeBanners = (db.banners || []).filter(b => b.active);
    res.json({
        success: true,
        config: publicConfig,
        banners: activeBanners,
        stats: {
            totalStreams: db.stats?.totalStreams || 0,
            totalUsers: (db.users || []).length
        }
    });
});

// 2. Trending Music Feed
app.get('/api/music/trending', async (req, res) => {
    const category = req.query.category || 'Top Trending';
    const page = parseInt(req.query.page || '1', 10);
    try {
        const songs = await musicBridge.getTrending(category, page);
        res.json({ success: true, count: songs.length, songs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. Search Songs
app.get('/api/music/search', async (req, res) => {
    const q = req.query.q || '';
    const page = parseInt(req.query.page || '1', 10);
    if (!q.trim()) return res.json({ success: true, count: 0, songs: [] });
    try {
        const songs = await musicBridge.searchJioSaavn(q, page, 50);
        res.json({ success: true, count: songs.length, songs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. Personalized Artist Feed (For You)
app.get('/api/music/for-you', async (req, res) => {
    const artistsStr = req.query.artists || '';
    const page = parseInt(req.query.page || '1', 10);
    const artists = artistsStr.split(',').map(a => a.trim()).filter(Boolean);
    try {
        const songs = await musicBridge.getPersonalizedFeed(artists, page);
        res.json({ success: true, count: songs.length, songs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. Track stream event & stats
app.post('/api/music/play', (req, res) => {
    const { songId, userId } = req.body;
    const db = readDb();
    db.stats = db.stats || { totalStreams: 0 };
    db.stats.totalStreams = (db.stats.totalStreams || 0) + 1;
    if (userId) {
        const user = (db.users || []).find(u => u.id === userId);
        if (user) user.streamCount = (user.streamCount || 0) + 1;
    }
    writeDb(db);
    res.json({ success: true, totalStreams: db.stats.totalStreams });
});

// 6. User Login / Registration
app.post('/api/auth/login', (req, res) => {
    const { phone, password, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    const db = readDb();
    db.users = db.users || [];
    let user = db.users.find(u => u.phone === phone);

    if (user) {
        if (user.status === 'blocked') {
            return res.status(403).json({ error: 'This user account is suspended by administrator.' });
        }
        return res.json({ success: true, isNewUser: false, user });
    } else {
        user = {
            id: `u_${Date.now()}`,
            name: name || `Listener_${phone.slice(-4)}`,
            phone,
            password: password || '',
            isGuest: false,
            status: 'active',
            joinedAt: new Date().toISOString(),
            streamCount: 0
        };
        db.users.push(user);
        db.stats.totalUsers = db.users.length;
        writeDb(db);
        return res.json({ success: true, isNewUser: true, user });
    }
});

// 7. Instant Guest Login
app.post('/api/auth/guest', (req, res) => {
    const randomId = Math.floor(1000 + Math.random() * 9000);
    const guestUser = {
        id: `guest_${Date.now()}`,
        name: `Guest_${randomId}`,
        phone: '',
        isGuest: true,
        status: 'active',
        joinedAt: new Date().toISOString(),
        streamCount: 0
    };
    const db = readDb();
    db.users = db.users || [];
    db.users.push(guestUser);
    db.stats.totalUsers = db.users.length;
    writeDb(db);
    res.json({ success: true, user: guestUser });
});

// -------------------------------------------------------------
// ADMIN MANAGEMENT ENDPOINTS
// -------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const db = readDb();
    const correctPassword = db.config?.adminPassword || 'admin123';
    if (password === correctPassword) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token, config: db.config });
    } else {
        return res.status(401).json({ success: false, error: 'Incorrect Admin Password' });
    }
});

// Get Full Admin Data
app.get('/api/admin/data', authAdmin, (req, res) => {
    const db = readDb();
    res.json({ success: true, data: db });
});

// Update Branding & App Config
app.post('/api/admin/config', authAdmin, (req, res) => {
    const { appName, brandSubtitle, announcement, isAnnouncementActive, youtubeHandle, youtubeUrl, adminPassword } = req.body;
    const db = readDb();
    db.config = db.config || {};
    if (appName !== undefined) db.config.appName = appName;
    if (brandSubtitle !== undefined) db.config.brandSubtitle = brandSubtitle;
    if (announcement !== undefined) db.config.announcement = announcement;
    if (isAnnouncementActive !== undefined) db.config.isAnnouncementActive = Boolean(isAnnouncementActive);
    if (youtubeHandle !== undefined) db.config.youtubeHandle = youtubeHandle;
    if (youtubeUrl !== undefined) db.config.youtubeUrl = youtubeUrl;
    if (adminPassword && adminPassword.trim().length >= 4) db.config.adminPassword = adminPassword.trim();

    writeDb(db);
    res.json({ success: true, message: 'Settings updated successfully', config: db.config });
});

// Upload Image (Logo or Banner)
app.post('/api/admin/upload', authAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, fileUrl });
});

// Set Logo or Banner from Admin
app.post('/api/admin/set-image', authAdmin, (req, res) => {
    const { type, imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });
    const db = readDb();
    db.config = db.config || {};
    if (type === 'logo') {
        db.config.logoUrl = imageUrl;
    } else if (type === 'banner') {
        db.config.bannerImageUrl = imageUrl;
    }
    writeDb(db);
    res.json({ success: true, message: `${type} updated successfully`, config: db.config });
});

// Add Promotional Banner
app.post('/api/admin/banners', authAdmin, (req, res) => {
    const { title, subtitle, imageUrl, linkUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Banner image URL is required' });
    const db = readDb();
    db.banners = db.banners || [];
    const newBanner = {
        id: `b_${Date.now()}`,
        title: title || 'Featured Release',
        subtitle: subtitle || 'Tap to stream',
        imageUrl,
        linkUrl: linkUrl || '',
        active: true
    };
    db.banners.push(newBanner);
    writeDb(db);
    res.json({ success: true, message: 'Banner added successfully', banner: newBanner });
});

// Toggle Banner Active
app.post('/api/admin/banners/:id/toggle', authAdmin, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const banner = (db.banners || []).find(b => b.id === id);
    if (!banner) return res.status(404).json({ error: 'Banner not found' });
    banner.active = !banner.active;
    writeDb(db);
    res.json({ success: true, banner });
});

// Delete Banner
app.delete('/api/admin/banners/:id', authAdmin, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    db.banners = (db.banners || []).filter(b => b.id !== id);
    writeDb(db);
    res.json({ success: true, message: 'Banner deleted' });
});

// Toggle User Block/Active
app.post('/api/admin/users/:id/toggle-block', authAdmin, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const user = (db.users || []).find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.status = user.status === 'blocked' ? 'active' : 'blocked';
    writeDb(db);
    res.json({ success: true, user });
});

// Delete User
app.delete('/api/admin/users/:id', authAdmin, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    db.users = (db.users || []).filter(u => u.id !== id);
    db.stats.totalUsers = db.users.length;
    writeDb(db);
    res.json({ success: true, message: 'User deleted' });
});

// HTML entry points
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🎵 SUNO MEWAT Web & Admin Server Running!`);
    console.log(`🌐 Local Web Player:   http://localhost:${PORT}`);
    console.log(`👑 Admin Dashboard:    http://localhost:${PORT}/admin`);
    console.log(`📱 iPhone/Mobile WiFi: http://10.46.173.170:${PORT}`);
    console.log(`=======================================================`);
});
