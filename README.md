# TwitchEventSubServer
Simple server used to connect to Twitch EventSub subscriptions and send the received info to another websocket server.

I had to make this since Twitch is forcing an SSL connection with a certificate to access their EventSub subscriptions, that comes with more features than the PubSub using only websockets.
Currently running on a web hosted Debian VM.