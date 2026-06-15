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
    let targetDate = params.date || new Date().toISOString().split('T')[0];

    const { data: dbMatches, error } = await supabase
      .from('matches')
      .select(\`
        id, match_date, local_date, status_short, status_elapsed,
        home_goals, away_goals, stream_url,
        home_team:teams!matches_home_team_id_fkey (name, logo_url),
        away_team:teams!matches_away_team_id_fkey (name, logo_url)
      \`)
      .eq('local_date', targetDate)
      .order('match_date', { ascending: true });

    if (error) throw error;

    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      // Use status and goals directly from the database as requested
      const status = dbMatch.status_short || 'NS';
      const elapsed = dbMatch.status_elapsed || '';
      const homeGoals = dbMatch.home_goals ?? 0;
      const awayGoals = dbMatch.away_goals ?? 0;

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
