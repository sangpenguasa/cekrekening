// Jam server (tanpa Redis, tanpa cache) untuk sinkronisasi hitung mundur di browser.
export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  return response.status(200).json({ now: Date.now() });
}
