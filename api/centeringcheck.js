/**
 * Vercel Serverless Proxy for CenteringCheck.com API
 */

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

    // Forward request to CenteringCheck API with spoofed headers
    const response = await fetch('https://www.centeringcheck.com/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.centeringcheck.com',
        'Referer': 'https://www.centeringcheck.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ image, warp }),
    });

    console.log('CenteringCheck response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CenteringCheck API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'CenteringCheck API error',
        status: response.status,
        details: errorText.substring(0, 500)
      });
    }

    const data = await response.json();
    console.log('CenteringCheck success, got borders:', !!data.borders);

    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: 'Proxy request failed',
      message: error.message
    });
  }
};

// Vercel config - increase body size limit for base64 images
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
