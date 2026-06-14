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

  if (event.httpMethod === 'OPTIONS' ) {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const params = event.queryStringParameters || {};
    
    // 1. Get the target date (Default to today)
    let targetDate = params.date; 
    if (!targetDate) {
      targetDate = new Date().toISOString().split('T')[0];
    }

    // 2. Fetch matches from your Supabase database
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

    // 3. Fetch live scores from streamed.pk API
    let liveScores = [];
    try {
        const response = await fetch('https://streamed.pk/api/matches/live' );
        if (response.ok) {
            liveScores = await response.json();
        }
    } catch (e) {
        console.error('Failed to fetch live scores:', e);
    }

    // 4. Merge the data
    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      // Find a matching game in the live API by team names
      const liveMatch = liveScores.find(ls => 
        ls.category === 'football' && 
        (ls.title.toLowerCase().includes(dbMatch.home_team.name.toLowerCase()) || 
         ls.title.toLowerCase().includes(dbMatch.away_team.name.toLowerCase()))
      );

      // Default to database values
      let status = dbMatch.status_short;
      let homeGoals = dbMatch.home_goals;
      let awayGoals = dbMatch.away_goals;

      // If live data found on streamed.pk, set status to LIVE
      if (liveMatch) {
          status = 'LIVE';
      }

      return {
        id: dbMatch.id,
        date: dbMatch.match_date,
        status: { short: status, elapsed: dbMatch.status_elapsed },
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
