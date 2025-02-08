// functions/image-proxy.js
export async function onRequestGet({ request }) {
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get('url');

    if (!imageUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    try {
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorker/1.0)',
            }
        });

        return new Response(response.body, {
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}