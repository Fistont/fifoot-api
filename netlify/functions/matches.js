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
    
    // FIX: We now use the 'local_date' column we created in the database
    let targetDate = params.date; 
    if (!targetDate) {
      targetDate = new Date().toISOString().split('T')[0];
    }

    let query = supabase
      .from('matches')
      .select(`
        id, match_date, local_date, status_short, status_elapsed,
        home_goals, away_goals, stream_url, is_favorite,
        home_team:teams!matches_home_team_id_fkey (id, name, logo_url),
        away_team:teams!matches_away_team_id_fkey (id, name, logo_url)
      `)
      .eq('local_date', targetDate) // This is the magic line that fixes the date!
      .order('match_date', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const formattedMatches = (data || []).map((match) => ({
      id: match.id,
      date: match.match_date,
      status: { short: match.status_short, elapsed: match.status_elapsed },
      teams: {
        home: { name: match.home_team?.name, logo: match.home_team?.logo_url },
        away: { name: match.away_team?.name, logo: match.away_team?.logo_url },
      },
      goals: { home: match.home_goals, away: match.away_goals },
      stream_url: match.stream_url,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ date: targetDate, matches: formattedMatches }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
