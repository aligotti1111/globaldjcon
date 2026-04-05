exports.handler = async function(event) {
  const { address } = event.queryStringParameters || {};
  if (!address) return { statusCode: 400, body: JSON.stringify({ error: 'Missing address' }) };

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'GlobalDJConnect/1.0 (globaldjconnect.com)',
        'Accept-Language': 'en'
      }
    });
    const data = await res.json();
    if (!data[0]) return { statusCode: 200, body: JSON.stringify({ lat: null, lon: null }) };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
