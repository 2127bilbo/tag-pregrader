/**
 * Vercel Serverless Proxy for CenteringCheck.com API
 */

const https = require('https');

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', received: req.method });
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { image, warp = true } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    console.log('Proxying to CenteringCheck, image length:', image.length);

    // Use https module instead of fetch for better Node.js compatibility
    const postData = JSON.stringify({ image, warp });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.centeringcheck.com',
        port: 443,
        path: '/api/upload',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Origin': 'https://www.centeringcheck.com',
          'Referer': 'https://www.centeringcheck.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          console.log('CenteringCheck response status:', response.statusCode);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve({ ok: true, data: JSON.parse(data) });
            } catch (e) {
              reject(new Error('Failed to parse response: ' + data.substring(0, 200)));
            }
          } else {
            resolve({ ok: false, status: response.statusCode, data: data.substring(0, 500) });
          }
        });
      });

      request.on('error', (e) => {
        console.error('Request error:', e.message);
        reject(e);
      });

      request.write(postData);
      request.end();
    });

    if (!result.ok) {
      console.error('CenteringCheck API error:', result.status, result.data);
      return res.status(result.status || 502).json({
        error: 'CenteringCheck API error',
        status: result.status,
        details: result.data
      });
    }

    console.log('CenteringCheck success, got borders:', !!result.data.borders);
    return res.status(200).json(result.data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(500).json({
      error: 'Proxy request failed',
      message: error.message
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
