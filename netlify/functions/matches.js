<div class="widget-matches-container">
    <div class="widget-matches-header">
        <h2 class="widget-matches-title">Today Match</h2>
        <p id="widget-date-display" style="text-align:center;color:#888;margin-top:5px;"></p>
    </div>
    <div class="date-nav-bar">
        <button class="date-nav-btn" onclick="fifoot.changeDay(-1)">&#8249; Prev</button>
        <span class="date-nav-label" id="date-nav-label">Today</span>
        <button class="date-nav-btn" onclick="fifoot.changeDay(1)">Next &#8250;</button>
    </div>
    <div class="matches-grid" id="matches-grid">
        <p style="text-align:center;color:#777;padding:20px;">Loading matches...</p>
    </div>
</div>
<script>
(function(){
    const API_URL='https://heartfelt-bavarois-6e8726.netlify.app/api/matches';
    
    const getLocalDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const fifoot={
        date:new Date(),
        formatDate:d=>getLocalDate(d),
        changeDay:n=>{
            fifoot.date.setDate(fifoot.date.getDate()+n);
            fifoot.render();
        },
        getStatus:(s,e)=>{
            if(['LIVE','1H','2H','ET','PEN'].includes(s))return{text:`LIVE ${e||''}'`,cls:'status-live'};
            if(s==='HT')return{text:'HALF TIME',cls:'status-live'};
            if(['FT','AET'].includes(s))return{text:'FINISHED',cls:'status-ft'};
            return{text:'UPCOMING',cls:'status-ns'};
        },
        render:()=>{
            const ds=fifoot.formatDate(fifoot.date);
            const today = getLocalDate(new Date());
            document.getElementById('date-nav-label').textContent = (ds === today) ? 'Today' : ds;
            
            // STAGE 1: Instant Load from DB (fast=true)
            fifoot.fetchMatches(ds, true).then(() => {
                // STAGE 2: Background Update with Live Status (fast=false)
                fifoot.fetchMatches(ds, false);
            });
        },
        fetchMatches:(dateStr, isFast)=>{
            return fetch(`${API_URL}?date=${dateStr}${isFast ? '&fast=true' : ''}`)
                .then(r=>r.json())
                .then(data=>{
                    const grid=document.getElementById('matches-grid');
                    // Only clear grid if it's the fast initial load or if matches changed
                    if(isFast || grid.innerHTML.includes('No matches')) {
                        grid.innerHTML=data.matches.length?'':`<p style="grid-column:1/-1;text-align:center;padding:40px;color:#999;">No matches scheduled for this date.</p>`;
                    }
                    
                    data.matches.forEach(m=>{
                        const status=fifoot.getStatus(m.status.short,m.status.elapsed);
                        const time=new Date(m.date).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
                        
                        let card = document.querySelector(`[data-match-id="${m.id}"]`);
                        if(!card) {
                            card = document.createElement('div');
                            card.className = 'match-card';
                            card.setAttribute('data-match-id', m.id);
                            grid.appendChild(card);
                        }

                        card.innerHTML=`
                            <div class="teams-display">
                                <div class="team-info"><img src="${m.teams.home.logo}" class="team-logo"><div class="team-name">${m.teams.home.name}</div></div>
                                <div class="vs-area">
                                    <div class="score-box">${m.status.short==='NS'?'VS':m.goals.home+'-'+m.goals.away}</div>
                                    <div class="match-time">${time}</div>
                                    <div class="status-badge ${status.cls}">${status.text}</div>
                                </div>
                                <div class="team-info"><img src="${m.teams.away.logo}" class="team-logo"><div class="team-name">${m.teams.away.name}</div></div>
                            </div>
                            <a href="${m.stream_url}" target="_blank" class="stream-button ${m.status.short==='FT'?'ended':''}">
                                ${m.status.short==='FT'?'MATCH ENDED':'WATCH STREAM'}
                            </a>`;
                    });
                }).catch(err=>console.error('Fetch error:', err));
        }
    };
    window.fifoot=fifoot;
    fifoot.render();

    setInterval(() => {
        const ds=fifoot.formatDate(fifoot.date);
        const today = getLocalDate(new Date());
        if(ds === today) { fifoot.fetchMatches(ds, false); }
    }, 60000);
})();
</script>
