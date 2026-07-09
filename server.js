const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, "database.db");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

let activeDisplay = null;
let lastEspPollAt = null;
let lastEspIp = null;
let dbReady = false;

function openDatabase() {
    return new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error("SQLite connection error:", err.message);
        } else {
            dbReady = true;
            console.log("SQLite connected:", DB_PATH);
        }
    });
}

const db = openDatabase();

function initDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                pixels TEXT NOT NULL,
                is_pinned INTEGER DEFAULT 0,
                is_showing INTEGER DEFAULT 1,
                is_new INTEGER DEFAULT 1,
                width INTEGER DEFAULT 16,
                height INTEGER DEFAULT 16
            )
        `);

        [
            "ALTER TABLE submissions ADD COLUMN is_pinned INTEGER DEFAULT 0",
            "ALTER TABLE submissions ADD COLUMN is_showing INTEGER DEFAULT 1",
            "ALTER TABLE submissions ADD COLUMN is_new INTEGER DEFAULT 1",
            "ALTER TABLE submissions ADD COLUMN width INTEGER DEFAULT 16",
            "ALTER TABLE submissions ADD COLUMN height INTEGER DEFAULT 16"
        ].forEach((sql) => {
            db.run(sql, (err) => {
                if (err && !err.message.includes("duplicate column name")) {
                    console.warn("Migration warning:", err.message);
                }
            });
        });
    });
}

function clampByte(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(255, Math.round(number)));
}

function parsePixels(value) {
    const pixels = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(pixels)) {
        throw new Error("pixels must be an array");
    }

    return pixels.map((pixel) => ({
        r: clampByte(pixel && pixel.r),
        g: clampByte(pixel && pixel.g),
        b: clampByte(pixel && pixel.b)
    }));
}

function detectSourceSize(pixels) {
    if (pixels.length === 512) return { width: 32, height: 16 };

    const side = Math.sqrt(pixels.length);
    if (Number.isInteger(side)) {
        return { width: side, height: side };
    }

    return { width: pixels.length, height: 1 };
}

function resizePixels(pixels, targetWidth, targetHeight) {
    const source = detectSourceSize(pixels);
    const resized = [];

    for (let ty = 0; ty < targetHeight; ty += 1) {
        const yStart = Math.floor((ty * source.height) / targetHeight);
        const yEnd = Math.max(yStart + 1, Math.floor(((ty + 1) * source.height) / targetHeight));

        for (let tx = 0; tx < targetWidth; tx += 1) {
            const xStart = Math.floor((tx * source.width) / targetWidth);
            const xEnd = Math.max(xStart + 1, Math.floor(((tx + 1) * source.width) / targetWidth));
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;

            for (let sy = yStart; sy < yEnd && sy < source.height; sy += 1) {
                for (let sx = xStart; sx < xEnd && sx < source.width; sx += 1) {
                    const pixel = pixels[(sy * source.width) + sx] || { r: 0, g: 0, b: 0 };
                    r += pixel.r;
                    g += pixel.g;
                    b += pixel.b;
                    count += 1;
                }
            }

            resized.push({
                r: clampByte(r / count),
                g: clampByte(g / count),
                b: clampByte(b / count)
            });
        }
    }

    return resized;
}

function buildLedPayload(row, width, height) {
    const sourcePixels = parsePixels(row.pixels);
    return {
        id: row.id,
        nickname: row.nickname,
        timestamp: row.timestamp,
        width,
        height,
        sourceWidth: detectSourceSize(sourcePixels).width,
        sourceHeight: detectSourceSize(sourcePixels).height,
        pixels: resizePixels(sourcePixels, width, height)
    };
}

function getLedSize(req) {
    const width = Math.max(1, Math.min(64, parseInt(req.query.width || "5", 10)));
    const height = Math.max(1, Math.min(64, parseInt(req.query.height || "5", 10)));
    return { width, height };
}

function markEspPoll(req) {
    if (req.query.device === "esp32") {
        lastEspPollAt = new Date();
        lastEspIp = req.ip;
    }
}

function getEspStatus() {
    const connected = !!lastEspPollAt && (Date.now() - lastEspPollAt.getTime()) < 5000;
    return {
        connected,
        lastSeenAt: lastEspPollAt ? lastEspPollAt.toISOString() : null,
        ip: lastEspIp
    };
}

function checkDatabase() {
    return new Promise((resolve) => {
        if (!dbReady) {
            resolve({ connected: false, error: "database is not ready" });
            return;
        }

        db.get("SELECT 1 AS ok", [], (err) => {
            if (err) {
                resolve({ connected: false, error: err.message });
            } else {
                resolve({ connected: true, path: DB_PATH });
            }
        });
    });
}

initDatabase();

app.get("/", (req, res) => {
    res.json({
        name: "LED Dot Canvas Server",
        ok: true,
        endpoints: ["/submissions", "/display/:id", "/display/current"]
    });
});

app.get("/status", async (req, res) => {
    const database = await checkDatabase();
    res.json({
        server: { connected: true },
        database,
        esp32: getEspStatus()
    });
});

app.get("/submissions", (req, res) => {
    db.all("SELECT * FROM submissions ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(rows);
    });
});

app.post("/submissions", (req, res) => {
    const { nickname, timestamp, pixels, is_pinned, is_showing, is_new, width, height } = req.body;

    if (!pixels) {
        return res.status(400).json({ error: "pixels is required" });
    }

    try {
        parsePixels(pixels);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    // width と height のデフォルト値
    const parsedWidth = width || 16;
    const parsedHeight = height || 16;

    return db.run(
        `
        INSERT INTO submissions (nickname, timestamp, pixels, is_pinned, is_showing, is_new, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            nickname || "anonymous",
            timestamp || new Date().toISOString(),
            typeof pixels === "string" ? pixels : JSON.stringify(pixels),
            is_pinned ? 1 : 0,
            is_showing === undefined ? 1 : (is_showing ? 1 : 0),
            is_new === undefined ? 1 : (is_new ? 1 : 0),
            parsedWidth,
            parsedHeight
        ],
        function onInsert(err) {
            if (err) return res.status(500).json({ error: err.message });
            return res.json({ message: "saved", id: this.lastID });
        }
    );
});

app.patch("/submissions/:id", (req, res) => {
    const { id } = req.params;
    const { is_pinned, is_showing, is_new } = req.body;
    const fields = [];
    const values = [];

    if (is_pinned !== undefined) {
        fields.push("is_pinned = ?");
        values.push(is_pinned ? 1 : 0);
    }
    if (is_showing !== undefined) {
        fields.push("is_showing = ?");
        values.push(is_showing ? 1 : 0);
    }
    if (is_new !== undefined) {
        fields.push("is_new = ?");
        values.push(is_new ? 1 : 0);
    }

    if (fields.length === 0) {
        return res.status(400).json({ error: "no update fields" });
    }

    values.push(id);

    return db.run(`UPDATE submissions SET ${fields.join(", ")} WHERE id = ?`, values, function onUpdate(err) {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ message: "updated", changes: this.changes });
    });
});

app.delete("/submissions/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM submissions WHERE id = ?", [id], function onDelete(err) {
        if (err) return res.status(500).json({ error: err.message });

        if (activeDisplay && activeDisplay.id === Number(id)) {
            activeDisplay = null;
        }

        return res.json({ message: "deleted", changes: this.changes });
    });
});

app.post("/display/:id", (req, res) => {
    const { id } = req.params;
    const { width, height } = getLedSize(req);

    db.get("SELECT * FROM submissions WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "submission not found" });

        try {
            activeDisplay = buildLedPayload(row, width, height);
            return res.json({ message: "display updated", display: activeDisplay });
        } catch (parseErr) {
            return res.status(500).json({ error: parseErr.message });
        }
    });
});

app.get("/display/current", (req, res) => {
    markEspPoll(req);
    const { width, height } = getLedSize(req);

    if (!activeDisplay) {
        return res.status(404).json({ error: "no active display" });
    }

    if (activeDisplay.width === width && activeDisplay.height === height) {
        return res.json(activeDisplay);
    }

    return db.get("SELECT * FROM submissions WHERE id = ?", [activeDisplay.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "active submission not found" });

        try {
            activeDisplay = buildLedPayload(row, width, height);
            return res.json(activeDisplay);
        } catch (parseErr) {
            return res.status(500).json({ error: parseErr.message });
        }
    });
});

// --- ヘルスチェックエンドポイント（DB接続確認） ---
app.get("/health", (req, res) => {
    if (!dbReady) {
        return res.status(503).json({ 
            status: "error", 
            message: "Database not ready" 
        });
    }

    // DBが実際に使用可能か確認
    db.get("SELECT 1", (err) => {
        if (err) {
            return res.status(503).json({ 
                status: "error", 
                message: "Database connection failed: " + err.message 
            });
        }
        return res.json({ 
            status: "ok", 
            message: "Server and database are ready" 
        });
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
