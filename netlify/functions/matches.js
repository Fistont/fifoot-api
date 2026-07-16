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
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const params = event.queryStringParameters || {};
    
    // Timezone Fix: America/Chicago (CDT)
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
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

    const isFastMode = params.fast === 'true';
    let liveData = [];
    let streamedPkMatches = [];

    // Only fetch live data if NOT in fast mode
    if (!isFastMode) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            
            // Fetch Scores
            const scoreResponse = await fetch('https://worldcup26.ir/get/games', { signal: controller.signal });
            if (scoreResponse.ok) {
                const json = await scoreResponse.json();
                liveData = json.games || [];
            }

            // NEW: Fetch Streams from streamed.pk
            const streamResponse = await fetch('https://streamed.pk/api/matches/all-today', { signal: controller.signal });
            if (streamResponse.ok) {
                streamedPkMatches = await streamResponse.json();
            }

            clearTimeout(timeoutId);
        } catch (e) {
            console.error('Live APIs fetch failed:', e.message);
        }
    }

    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      const normalize = (name) => {
          let n = (name || "").toLowerCase();
          if (n.includes("ivory coast") || n.includes("cote d'ivoire") || n.includes("côte d'ivoire")) return "ivory coast";
          if (n.includes("dr congo") || n.includes("congo dr")) return "dr congo";
          if (n.includes("usa") || n.includes("united states")) return "usa";
          return n;
      };

      const dbHome = normalize(dbMatch.home_team?.name);
      const dbAway = normalize(dbMatch.away_team?.name);

      // Match for Scores
      const liveGame = liveData.find(g => 
        normalize(g.home_team_name_en).includes(dbHome) &&
        normalize(g.away_team_name_en).includes(dbAway)
      );

      // NEW: Match for Streams
      const streamGame = streamedPkMatches.find(g => 
        (normalize(g.teams?.home?.name || "").includes(dbHome) || dbHome.includes(normalize(g.teams?.home?.name || ""))) &&
        (normalize(g.teams?.away?.name || "").includes(dbAway) || dbAway.includes(normalize(g.teams?.away?.name || "")))
      );

      let status = dbMatch.status_short || 'NS';
      let elapsed = dbMatch.status_elapsed || '';
      let homeGoals = dbMatch.home_goals || 0;
      let awayGoals = dbMatch.away_goals || 0;
      let autoStream = null;

      if (liveGame) {
          if (liveGame.finished === "TRUE") {
              status = 'FT';
          } else if (liveGame.time_elapsed && liveGame.time_elapsed.toLowerCase() !== 'notstarted') {
              status = 'LIVE';
              elapsed = liveGame.time_elapsed === 'half-time' ? 'HT' : (liveGame.time_elapsed === 'live' ? '' : liveGame.time_elapsed);
          }
          homeGoals = liveGame.home_score ?? homeGoals;
          awayGoals = liveGame.away_score ?? awayGoals;
      }

      // NEW: Set Auto Stream Data
      if (streamGame && streamGame.sources && streamGame.sources.length > 0) {
          autoStream = {
              source: streamGame.sources[0].source,
              id: streamGame.sources[0].id
          };
      }

      return {
        id: dbMatch.id,
        date: dbMatch.match_date,
        status: { short: status, elapsed: elapsed },
        teams: {
          home: { 
            name: dbMatch.home_team?.name || 'Unknown', 
            logo: dbMatch.home_team?.logo_url || '' 
          },
          away: { 
            name: dbMatch.away_team?.name || 'Unknown', 
            logo: dbMatch.away_team?.logo_url || '' 
          }
        },
        goals: { home: homeGoals, away: awayGoals },
        stream_url: dbMatch.stream_url,
        auto_stream: autoStream
      };
    });

    return { 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ 
            date: targetDate, 
            matches: formattedMatches,
            is_fast: isFastMode 
        }) 
    };
  } catch (err) {
    console.error('Handler Error:', err.message);
    return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: err.message, matches: [] }) 
    };
  }
};
