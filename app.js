import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji, DiscordRequest } from './utils.js';
import { getShuffledOptions, getResult } from './game.js';
import { google } from 'googleapis';

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// To keep track of our active games
const activeGames = {};

async function appendToSheet(row) {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  // Add header row if sheet is empty
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:F1',
  });

  if (!existing.data.values) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1:F1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Suggested By', 'Song Title', 'Artist', 'Timestamp', 'Notes', 'Link']],
      },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:F',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    // "test" command
    if (name === 'test') {
      // Send a message into the channel where command was triggered from
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              // Fetches a random emoji to send from a helper function
              content: `hello world nathan ${getRandomEmoji()}`
            }
          ]
        },
      });
    }
    else if (name === 'suggest') {
      const link = data.options[0].value;
      const timestamp = data.options[1].value;
      const notes = data.options.find(o => o.name === 'note')?.value ?? '';      const spotifyRegex = /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/[\w]+/;
      const youtubeRegex = /https?:\/\/(www\.)?(youtube\.com\/watch\?[^\s]*v=[\w-]+|youtu\.be\/[\w-]+)/;
      const appleMusicRegex = /https?:\/\/music\.apple\.com\/[a-z]+\/(album|song)\/[^\s]+/;
      const soundcloudRegex = /https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/;

      if (!spotifyRegex.test(link) && !youtubeRegex.test(link) && !appleMusicRegex.test(link) && !soundcloudRegex.test(link)) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: `❌ That\'s not a Spotify, Apple Music, YouTube, or SoundCloud link — please use one of those URLs.`
              }
            ]
          },
        });
      }

      let songTitle, artists;

      if (spotifyRegex.test(link) || appleMusicRegex.test(link)) {
        // Spotify and AppleMusic 

        if (spotifyRegex.test(link)) {
          // Get Spotify access token (for artist names)
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),
            },
            body: 'grant_type=client_credentials',
          });
          const tokenData = await tokenRes.json();
          const accessToken = tokenData.access_token;

          // Extract track ID from link
          const trackId = link.match(/track\/([a-zA-Z0-9]+)/)?.[1];

          // Fetch track info
          const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          const trackData = await trackRes.json();
          console.log(trackData);

          songTitle = trackData.name;
          artists = trackData.artists.map(a => a.name).join(', ');
        }
        else if (appleMusicRegex.test(link)) {
          const songId = link.match(/\/(\d+)$/)?.[1];
          const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${songId}`);
          const itunesData = await itunesRes.json();
          const track = itunesData.results[0];
          console.log(track);
          
          songTitle = track.collectionName;
          artists = track.artistName;
        }

        const username = req.body.member.user.username;
        const date = new Date().toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        // Hyperlink formula for song title
        const hyperlink = `=HYPERLINK("${link}", "${songTitle}")`;

        await appendToSheet([
          username,
          hyperlink,
          artists ?? '',
          timestamp,
          notes ?? '',
          date,
        ]);

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🎵  **${songTitle}** by **${artists}** was suggested by <@${req.body.member.user.id}>
            \nTimestamp: ${timestamp}
            ${notes ? `\nNotes: ${notes}` : ''}
            \nLink: ${link}`,
          },
        });
      }
      else {
        // Youtube and Soundcloud
        if (youtubeRegex.test(link)) {
          const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`;
          const ytRes = await fetch(oEmbedUrl);
          const ytData = await ytRes.json();
          console.log(ytData);

          songTitle = ytData.title;
        }
        else if (soundcloudRegex.test(link)) {
          const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(link)}&format=json`;
          const scRes = await fetch(oEmbedUrl);
          const scData = await scRes.json();
          console.log(scData);

          songTitle = scData.title;
        }

        const username = req.body.member.user.username;
        const date = new Date().toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        // Hyperlink formula for song title
        const hyperlink = `=HYPERLINK("${link}", "${songTitle}")`;

        await appendToSheet([
          username,
          hyperlink,
          artists ?? '',
          timestamp,
          notes ?? '',
          date,
        ]);

        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `🎵  **${songTitle}** was suggested by <@${req.body.member.user.id}>
            \nTimestamp: ${timestamp}
            ${notes ? `\nNotes: ${notes}` : ''}
            \nLink: ${link}`,
          },
        });        
      }
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
