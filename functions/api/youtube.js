// functions/youtube-api.js
export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get('q');

    if (!searchQuery) {
        return new Response(JSON.stringify({ error: 'Search query parameter "q" is missing.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const youtubeResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery + ' official trailer')}&type=video&maxResults=1&key=${env.YOUTUBE_API_KEY}`
        );

        const data = await youtubeResponse.json();
        return new Response(JSON.stringify({
            videoId: data.items?.[0]?.id?.videoId
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
