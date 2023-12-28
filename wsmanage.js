const { WebSocketServer } = require('ws');
const fs = require('fs');
const fetch = require('node-fetch');

let extws;

const msg_con_open = {type: 'default', data: 'Websocket connection opened.'};

async function openWS() {

    const wss = new WebSocketServer({ port: 3002 });

    wss.on('connection', function connection(ws) {
        extws = ws;
        ws.on('message', function message(data) {
            console.log('received: %s', data);
            ws.send('Greetings');
        });

        ws.send(JSON.stringify(msg_con_open));
    });

    console.log('ws opened');
}

function sendTwitchData(tdata) {
    if (extws) {
        let toSend = {type: 'twitchData', data: tdata};
        extws.send(JSON.stringify(toSend));
    }
}

async function isTokenValid() {

    let headers_data = {
        "Authorization": "OAuth " + getToken()
    };
    let res = await fetch('https://id.twitch.tv/oauth2/validate',
        {method: 'get',
         headers: headers_data
    });

    return (await res.json()).status != 400;
}


/* Gets token from file token.txt */
function getToken() {
    return fs.readFileSync('token.txt', {encoding: 'utf-8'});
}

/* Ask for a new token */
async function getNewToken() {

    const req = 'https://id.twitch.tv/oauth2/token'
                + '?client_id=' + process.env.CLIENT_ID
                + '&client_secret=' + process.env.CLIENT_SECRET
                + '&grant_type=client_credentials';

    let res = await fetch(req, {method: 'post'});
    let ans = await res.json();
    saveToken(ans.access_token);
}

/* Save access token in token.txt file */
function saveToken(token) {
    try {
        fs.writeFileSync('token.txt', token);
    } catch (err) {
        console.error(err)
    }
}

exports.openWS = openWS;
exports.sendTwitchData = sendTwitchData;
exports.isTokenValid = isTokenValid;
exports.getToken = getToken;
exports.getNewToken = getNewToken;
