<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4eb5360b-4eda-4ba7-ae0d-0a30a85ae5bb

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Netlify

The Netlify configuration publishes the Vite build from `dist` and routes
`/api/generate` to the `netlify/functions/generate.mjs` serverless function.

1. Push this project to a Git provider and import the repository in Netlify.
2. In **Site configuration > Environment variables**, add `GEMINI_API_KEY`
   with your Google Gemini API key. Do not commit the key to the repository.
3. Deploy the site. Netlify uses `npm run build` and publishes `dist`.
