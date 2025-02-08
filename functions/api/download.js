// functions/download.js
export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const downloadUrl = url.searchParams.get('url');

    if (!downloadUrl) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const downloader = new DownloadFormSubmitter(true);
        const result = await downloader.submitForm(downloadUrl);
        return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}