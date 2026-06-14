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
    
    let targetDate = params.date; 
    if (!targetDate) {
      targetDate = new Date().toISOString().split('T')[0];
    }

    // 1. Fetch matches from your Supabase database
    let query = supabase
      .from('matches')
      .select(`
        id, match_date, local_date, status_short, status_elapsed,
        home_goals, away_goals, stream_url, is_favorite,
        home_team:teams!matches_home_team_id_fkey (id, name, logo_url),
        away_team:teams!matches_away_team_id_fkey (id, name, logo_url)
      `)
      .eq('local_date', targetDate)
      .order('match_date', { ascending: true });

    const { data: dbMatches, error } = await query;
    if (error) throw error;

    // 2. Fetch real-time scores from WorldCup26 API
    let liveData = [];
    try {
        // Use a timeout to prevent the whole function from hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const response = await fetch('https://worldcup26.ir/get/games', { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const json = await response.json();
            liveData = json.games || [];
        }
    } catch (e) {
        console.error('Failed to fetch live scores:', e);
    }

    // 3. Merge the data
    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      // Find matching game in live API with safety checks
      const liveGame = liveData.find(g => {
        const homeName = dbMatch.home_team?.name?.toLowerCase();
        const awayName = dbMatch.away_team?.name?.toLowerCase();
        const apiHome = (g.home_team_name_en || "").toLowerCase();
        const apiAway = (g.away_team_name_en || "").toLowerCase();

        return (apiHome === homeName || apiHome.includes(homeName)) &&
               (apiAway === awayName || apiAway.includes(awayName));
      });

      // Default to database values
      let status = dbMatch.status_short || 'NS';
      let elapsed = dbMatch.status_elapsed || '';
      let homeGoals = dbMatch.home_goals || 0;
      let awayGoals = dbMatch.away_goals || 0;

      // If live data found, override with real scores and status
      if (liveGame) {
          if (liveGame.finished === "TRUE") {
              status = 'FT';
          } else if (liveGame.time_elapsed === 'live' || liveGame.time_elapsed === 'half-time') {
              status = 'LIVE';
              elapsed = liveGame.time_elapsed === 'half-time' ? 'HT' : (liveGame.time_elapsed || '');
          }
          homeGoals = liveGame.home_score !== undefined ? liveGame.home_score : homeGoals;
          awayGoals = liveGame.away_score !== undefined ? liveGame.away_score : awayGoals;
      }

      return {
        id: dbMatch.id,
        date: dbMatch.match_date,
        status: { short: status, elapsed: elapsed },
        teams: {
          home: { name: dbMatch.home_team?.name, logo: dbMatch.home_team?.logo_url },
          away: { name: dbMatch.away_team?.name, logo: dbMatch.away_team?.logo_url },
        },
        goals: { home: homeGoals, away: awayGoals },
        stream_url: dbMatch.stream_url,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ date: targetDate, matches: formattedMatches }),
    };
  } catch (err) {
    console.error('API Error:', err);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: "Server Error: " + err.message }) 
    };
  }
};
