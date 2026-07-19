const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const params = event.queryStringParameters || {};
    
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const todayCDT = formatter.format(now);
    let targetDate = params.date || todayCDT;

    // 1. Fetch from Supabase
    const { data: dbMatches, error } = await supabase
      .from('matches')
      .select(`
        id, match_date, local_date, status_short, status_elapsed,
        home_goals, away_goals, stream_url,
        home_team:teams!matches_home_team_id_fkey (name, logo_url),
        away_team:teams!matches_away_team_id_fkey (name, logo_url)
      `)
      .eq('local_date', targetDate)
      .order('match_date', { ascending: true });

    if (error) throw error;

    // 2. Fetch Streams from streamed.pk
    let streamedPkMatches = [];
    try {
        const streamResponse = await fetch('https://streamed.pk/api/matches/all-today');
        if (streamResponse.ok) {
            streamedPkMatches = await streamResponse.json();
        }
    } catch (e) {
        console.error('Streamed.pk fetch failed:', e.message);
    }

    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      const normalize = (name) => {
          if (!name) return "";
          return name.toLowerCase().replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric
      };

      const dbHome = normalize(dbMatch.home_team?.name);
      const dbAway = normalize(dbMatch.away_team?.name);

      // FUZZY MATCHING
      const streamGame = streamedPkMatches.find(g => {
          if (g.category !== 'football') return false;
          
          const sHome = normalize(g.teams?.home?.name || "");
          const sAway = normalize(g.teams?.away?.name || "");
          const sTitle = normalize(g.title || "");
          
          // Check if both team names are found anywhere in the stream data
          const homeFound = sHome.includes(dbHome) || dbHome.includes(sHome) || sTitle.includes(dbHome);
          const awayFound = sAway.includes(dbAway) || dbAway.includes(sAway) || sTitle.includes(dbAway);
          
          return homeFound && awayFound;
      });

      let autoStream = null;
      if (streamGame && streamGame.sources && streamGame.sources.length > 0) {
          const bestSource = streamGame.sources.find(s => s.source !== 'admin') || streamGame.sources[0];
          autoStream = {
              source: bestSource.source,
              id: bestSource.id
          };
      }

      return {
        id: dbMatch.id,
        date: dbMatch.match_date,
        status: { short: dbMatch.status_short, elapsed: dbMatch.status_elapsed },
        teams: {
          home: { name: dbMatch.home_team?.name, logo: dbMatch.home_team?.logo_url },
          away: { name: dbMatch.away_team?.name, logo: dbMatch.away_team?.logo_url }
        },
        goals: { home: dbMatch.home_goals, away: dbMatch.away_goals },
        stream_url: dbMatch.stream_url,
        auto_stream: autoStream
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ date: targetDate, matches: formattedMatches }) };
  } catch (err) {
    console.error('Handler Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
