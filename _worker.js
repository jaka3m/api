import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route: /check
    if (path === '/check') {
      return await handleCheck(request);
    }

    // Route: /hello
    if (path === '/hello') {
      return new Response(JSON.stringify({
        status: "online",
        message: "Proxy Checker API is running",
        version: "1.2 (Advanced Worker Mode)"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Fallback: Serve static assets (index.html, etc.)
    // Note: env.ASSETS is only available if the worker is deployed as part of a Pages project
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    // Default if not running in Pages or asset not found
    return new Response("Not Found", { status: 404 });
  }
};

async function handleCheck(request) {
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const ipParam = url.searchParams.get('ip');
    const format = url.searchParams.get('format') || 'json';

    if (!ipParam) {
        return new Response(JSON.stringify({ error: "Parameter 'ip' is required." }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const rawInputs = ipParam.split(',').map(s => s.trim()).filter(s => s);
    const MAX_BATCH_SIZE = 10;
    if (rawInputs.length > MAX_BATCH_SIZE) {
        return new Response(JSON.stringify({ error: `Maksimal ${MAX_BATCH_SIZE} IP per request.` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const results = new Array(rawInputs.length);
    const queue = rawInputs.map((input, index) => ({ input, index }));

    // Concurrency control: max 3 workers to stay within Cloudflare free tier limits
    const workers = Array(Math.min(3, queue.length)).fill(null).map(async () => {
        while (queue.length > 0) {
            const task = queue.shift();
            if (!task) break;
            try {
                results[task.index] = await processSingleProxy(task.input);
            } catch (e) {
                results[task.index] = { ip: task.input.split(/[:=-]/)[0], status: 'ERROR', error: e.message };
            }
        }
    });

    await Promise.all(workers);

    if (format === 'csv') {
        return new Response(convertToCSV(results), {
            headers: { 'Content-Type': 'text/csv' }
        });
    } else if (format === 'text') {
        return new Response(convertToText(results), {
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    const responseBody = results.length === 1
        ? { ...results[0], api_version: "1.2" }
        : results.map(r => ({ ...r, api_version: "1.2" }));

    return new Response(JSON.stringify(responseBody, null, 2), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function processSingleProxy(rawInput) {
    const parts = rawInput.split(/[:=-]/);
    const ip = parts[0];
    const port = parseInt(parts[1]) || 443;

    try {
        const checkResult = await checkProxy('speed.cloudflare.com', '/meta', ip, port);

        if (checkResult.error) {
            return { ip, port, status: 'DEAD', error: checkResult.error };
        }

        const { data, protocol, delay } = checkResult;
        const speed = await measureSpeed(ip, port);

        const countryCode = data.country || 'Unknown';
        const [countryName, countryFlag] = getCountryInfo(countryCode);

        let coloName = 'Unknown';
        if (data.colo) {
            coloName = typeof data.colo === 'object' ? (data.colo.iata || 'Unknown') : String(data.colo);
        }

        return {
            ip,
            port,
            status: 'ACTIVE',
            isp: cleanOrgName(data.asOrganization || 'Unknown'),
            countryCode,
            country: `${countryName} ${countryFlag || ''}`.trim(),
            asn: data.asn ? `AS${data.asn}` : 'Unknown',
            colo: coloName,
            httpProtocol: protocol,
            delay: `${Math.round(delay)} ms`,
            speed_est: speed,
            latitude: String(data.latitude || 'Unknown'),
            longitude: String(data.longitude || 'Unknown'),
        };
    } catch (e) {
        return { ip, port, status: 'DEAD', error: e.message };
    }
}

async function checkProxy(host, path, ip, port) {
    const startTime = Date.now();
    let socket;
    try {
        socket = connect({ hostname: ip, port: port, secureTransport: 'starttls' });
        const tlsSocket = socket.startTls({ expectedServerHostname: host });
        const writer = tlsSocket.writable.getWriter();
        const reader = tlsSocket.readable.getReader();

        const httpRequest =
            `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n` +
            `Accept: application/json\r\n` +
            `Referer: https://speed.cloudflare.com/\r\n` +
            `Connection: close\r\n\r\n`;

        await writer.write(new TextEncoder().encode(httpRequest));
        writer.releaseLock();

        let responseText = '';
        const decoder = new TextDecoder();

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Read timeout')), 7000)
        );

        const readPromise = (async () => {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                responseText += decoder.decode(value, { stream: true });
            }
            return responseText;
        })();

        const finalResponse = await Promise.race([readPromise, timeoutPromise]);
        const delay = Date.now() - startTime;

        const separatorIndex = finalResponse.indexOf('\r\n\r\n');
        if (separatorIndex === -1) return { error: 'Invalid response format' };

        const body = finalResponse.substring(separatorIndex + 4);
        let data;
        try {
            data = JSON.parse(body);
        } catch (e) {
            return { error: 'Failed to parse JSON response' };
        }

        const protocolMatch = finalResponse.match(/HTTP\/[0-9.]+/);
        const protocol = protocolMatch ? protocolMatch[0] : 'Unknown';

        return { data, protocol, delay };
    } catch (e) {
        return { error: e.message };
    } finally {
        if (socket) {
            try { socket.close(); } catch (e) {}
        }
    }
}

async function measureSpeed(ip, port) {
    const startTime = Date.now();
    let socket;
    try {
        socket = connect({ hostname: ip, port: port, secureTransport: 'starttls' });
        const tlsSocket = socket.startTls({ expectedServerHostname: 'www.google.com' });
        const writer = tlsSocket.writable.getWriter();
        const reader = tlsSocket.readable.getReader();

        const httpRequest =
            `GET /gen_204 HTTP/1.1\r\n` +
            `Host: www.google.com\r\n` +
            `Connection: close\r\n\r\n`;

        await writer.write(new TextEncoder().encode(httpRequest));
        writer.releaseLock();

        await Promise.race([
            reader.read(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);

        const endTime = Date.now();
        const diff = endTime - startTime;
        if (diff <= 0) return 'N/A';
        return `${(1000 / diff).toFixed(2)} KB/s`;
    } catch (e) {
        return 'N/A';
    } finally {
        if (socket) {
            try { socket.close(); } catch (e) {}
        }
    }
}

function cleanOrgName(orgName) {
    return orgName ? orgName.replace(/[^a-zA-Z0-9\s]/g, '') : orgName;
}

function getCountryInfo(countryCode) {
    try {
        const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
        const name = regionNames.of(countryCode.toUpperCase());
        const flag = getFlagEmoji(countryCode);
        return [name || countryCode, flag];
    } catch (e) {
        return [countryCode, ''];
    }
}

function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

function convertToCSV(results) {
    if (results.length === 0) return '';
    const allKeys = new Set();
    results.forEach(r => {
        if (r) Object.keys(r).forEach(k => allKeys.add(k));
    });
    const headers = Array.from(allKeys);

    const csvRows = [headers.join(',')];
    for (const r of results) {
        if (!r) continue;
        const values = headers.map(header => {
            const val = r[header] === undefined ? '' : r[header];
            return `"${String(val).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
}

function convertToText(results) {
    return results.map(r => {
        if (!r) return 'Unknown Error';
        if (r.status === 'ACTIVE') {
            return `[${r.status}] ${r.ip}:${r.port} - ${r.country || ''} (${r.isp || ''})`;
        } else {
            return `[${r.status}] ${r.ip}:${r.port} - Error: ${r.error || 'Unknown'}`;
        }
    }).join('\n');
}
