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
    
    // FIX: Use the user's local date (e.g., CDT) instead of UTC
    // We can default to the date in a specific timezone if not provided
    let targetDate = params.date;
    if (!targetDate) {
        // Calculate the date in CDT (UTC-5)
        // Since we are in June, it might be CDT (UTC-5) or CST (UTC-6)
        // We use a robust way to get the date in America/Chicago timezone
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        targetDate = formatter.format(now); // Returns YYYY-MM-DD
    }

    // 1. Fetch matches and team details from Supabase
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

    // 2. Fetch live data from the external API
    let liveData = [];
    try {
      const response = await fetch('https://worldcup26.ir/get/games');
      if (response.ok) {
        const json = await response.json();
        liveData = json.games || [];
      }
    } catch (e) {
      console.error('Live API fetch failed:', e);
    }

    // 3. Merge live data into DB matches
    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      const normalize = (name) => {
        let n = (name || "").toLowerCase();
        if (n.includes("ivory coast") || n.includes("cote d'ivoire") || n.includes("côte d'ivoire")) return "ivory coast";
        if (n.includes("dr congo") || n.includes("congo dr")) return "dr congo";
        if (n.includes("usa") || n.includes("united states")) return "usa";
        return n;
      };

      const dbHome = normalize(dbMatch.home_team.name);
      const dbAway = normalize(dbMatch.away_team.name);

      const liveGame = liveData.find(g => 
        normalize(g.home_team_name_en).includes(dbHome) &&
        normalize(g.away_team_name_en).includes(dbAway)
      );

      let status = dbMatch.status_short || 'NS';
      let elapsed = dbMatch.status_elapsed || '';
      let homeGoals = dbMatch.home_goals ?? 0;
      let awayGoals = dbMatch.away_goals ?? 0;

      if (liveGame) {
        if (liveGame.finished === "TRUE") {
          status = 'FT';
          elapsed = '';
        } else if (liveGame.time_elapsed && liveGame.time_elapsed.toLowerCase() !== 'notstarted') {
          status = 'LIVE';
          elapsed = liveGame.time_elapsed === 'half-time' ? 'HT' : 
                    (liveGame.time_elapsed === 'live' ? '' : liveGame.time_elapsed);
        }
        homeGoals = liveGame.home_score ?? homeGoals;
        awayGoals = liveGame.away_score ?? awayGoals;
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
      };
    });

    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ date: targetDate, matches: formattedMatches }) 
    };
  } catch (err) {
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: err.message }) 
    };
  }
};
