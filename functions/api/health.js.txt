// functions/health.js
export async function onRequest() {
    return new Response(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString()
    }), {
        headers: {
            'Content-Type': 'application/json'
        }
    });
}