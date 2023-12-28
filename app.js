require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const fetch = require('node-fetch');
const crypto = require('crypto');
const express = require('express');
const app = express();
const port = 443;

const { openWS, sendTwitchData, isTokenValid, getToken, getNewToken } = require('./wsmanage.js');

// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase();
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase();
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'.toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = 'sha256=';

function getSecret() {
    return process.env.SECRET_KEY;
}

// Build the message used to get the HMAC.
function getHmacMessage(request) {
    return (request.headers[TWITCH_MESSAGE_ID] +
        request.headers[TWITCH_MESSAGE_TIMESTAMP] +
        request.body);
}

// Get the HMAC.
function getHmac(secret, message) {
    return crypto.createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

// Verify whether our hash matches the hash that Twitch passed in the header.
function verifyMessage(hmac, verifySignature) {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}

app.use(express.raw({// Need raw message body for signature verification
    type: 'application/json'
}));

app.get('/', (req, res) => {
    console.log('Received get request on /');
    res.status(200).send('Hello there');
});

app.post('/eventsub', (req, res) => {
    console.log('Received post request on /eventsub');
    let secret = getSecret();
    let message = getHmacMessage(req);
    let hmac = HMAC_PREFIX + getHmac(secret, message);  // Signature to compare

    if (true === verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
        console.log("signatures match");

        // Get JSON object from body, so you can process the message.
        let notification = JSON.parse(req.body);

        if (MESSAGE_TYPE_NOTIFICATION === req.headers[MESSAGE_TYPE]) {

            // console.log(`Event type: ${notification.subscription.type}`);
            // console.log(JSON.stringify(notification.event, null, 4));

            console.log(notification);
            sendTwitchData(notification);
            console.log('----------------------');

            res.sendStatus(204);
        }
        else if (MESSAGE_TYPE_VERIFICATION === req.headers[MESSAGE_TYPE]) {
            console.log('Sending back challenge');
            res.status(200).send(notification.challenge);
        }
        else if (MESSAGE_TYPE_REVOCATION === req.headers[MESSAGE_TYPE]) {
            res.sendStatus(204);

            console.log(`${notification.subscription.type} notifications revoked!`);
            console.log(`reason: ${notification.subscription.status}`);
            console.log(`condition: ${JSON.stringify(notification.subscription.condition, null, 4)}`);
        }
        else {
            res.sendStatus(204);
            console.log(`Unknown message type: ${req.headers[MESSAGE_TYPE]}`);
        }
    }
    else {
        console.log('403');    // Signatures didn't match.
        res.sendStatus(403);
    }
});

let creds = {
    key: fs.readFileSync('pkey.key'),
    cert: fs.readFileSync('cert.cer'),
    ca: [
        fs.readFileSync('cert_inter.cer')
    ]
};

let httpsServer = https.createServer(creds, app);
httpsServer.listen(port);
console.log('Server opened on port ' + port);

checkSubscritptions();

openWS();

async function checkSubscritptions() {
    console.log('Checking subscriptions...');
    /* Get a list of all twitch active subscriptions */
    let twitchActiveSubscriptions = await getTwitchActiveSubscriptions();
    let activeTypes = twitchActiveSubscriptions.data.map(e => e.type);

    /* Find and delete failed subscriptions */
    for (let sub of twitchActiveSubscriptions.data) {
        if (sub.status == 'notification_failures_exceeded'
            || sub.status == 'webhook_callback_verification_failed'
            || sub.status == 'authorization_revoked'
            || sub.status == 'webhook_callback_verification_pending'
            || sub.status == 'user_removed ') {

            /* Delete subscription */
            await deleteSubscription(sub.id);
        }
    }

    /* Get a list of all twitch active subscriptions*/
    twitchActiveSubscriptions = await getTwitchActiveSubscriptions();
    activeTypes = twitchActiveSubscriptions.data.map(e => e.type);

    /* Get user desired subscritpions */
    let desiredSubscriptions = getDesiredSubscriptions();

    /* Find the missing subscriptions from Twitch */
    let missingSubscriptions = desiredSubscriptions.filter(el => !activeTypes.includes(el));

    /* Check for token validity */
    if (!await isTokenValid()) {
        console.log('invalid token');
        await getNewToken();
    }

    /* Check for missing subscriptions */
    if (missingSubscriptions.length != 0) {
        for (let sub of missingSubscriptions) {
            console.log(`Missing subscription '${sub}'`);
            await subscribe(sub);
        }
    }

}

async function getTwitchActiveSubscriptions() {
    let headers_data = {
        "Authorization": "Bearer " + getToken(),
        "Client-Id": process.env.CLIENT_ID
    };

    let res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions',
        {method: 'get', headers: headers_data});

    return await res.json();
}

async function deleteSubscription(subId) {
    let headers_data = {
        "Authorization": "Bearer " + getToken(),
        "Client-Id": process.env.CLIENT_ID
    };

    let res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions?id=' + subId,
        {method: 'delete',
         headers: headers_data
    });

    console.log('Sub deleted');
}

function getDesiredSubscriptions() {
    return JSON.parse(fs.readFileSync('./subscriptions.json', 'utf8'));
}

async function subscribe(subscriptionType) {

    let headers_data = {
        "Authorization": "Bearer " + getToken(),
        "Client-Id": process.env.CLIENT_ID,
        "Content-Type": "application/json"
    };

    let body_data = {
        "type": subscriptionType,
        "version": "1",
        "condition": {
            "broadcaster_user_id": process.env.CHANNEL_ID
        },
        "transport":
        {
            "method": "webhook",
            "callback": "<callback url>",
            "secret": getSecret()
        }
    };

    if (subscriptionType == 'channel.raid') {
        body_data.condition = {"to_broadcaster_user_id": process.env.CHANNEL_ID}
    }

    let res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions',
        {method: 'post',
         headers: headers_data,
         body: JSON.stringify(body_data)
    });

    let ans = (await res.json());

    console.log(`Subscribe sent for '${subscriptionType}'`);

}
