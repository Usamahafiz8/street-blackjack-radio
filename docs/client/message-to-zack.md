**Subject: Street Blackjack Radio: all four stages done, ready for your go-ahead**

Hi Zack,

Quick update on Street Blackjack Radio: all four stages of the brief have been built and tested on our test server. I've attached a 2-minute demo video, and the review link below goes through your brief point by point.

**Review (your brief, point by point):** https://claude.ai/artifact/MTg5WDtLAMQhUtCXZ6SsSg

**What's working now**
- **Five 24/7 stations:** UK Rap / Drill / Grime, Afrobeats / Amapiano, Dancehall / Reggae, R&B / Slow Jams, and Old School / Hip-Hop Classics. They broadcast continuously whether or not anyone is listening. In a 40-minute test with no listeners, every station kept playing, mix after mix, and looped by itself.
- **Real radio behaviour:** when someone tunes in, they join at the live point, not the start of a mix. In the video, playback is paused at 2:33 into a mix and comes back 80 seconds later at 3:54.
- **Adverts and promos:** each station has its own adverts (e.g. tournament promos, sponsors). They play between mixes, never cutting into one. Long DJ mixes are split into ~30-minute parts at natural transitions so there are regular breaks; the original files are kept. Limited-time campaigns work too, e.g. a promo that runs for one week only.
- **Scheduling:** shows can be set for particular days and times. "Friday Night Dancehall" took over its Friday slot automatically in testing.
- **Admin dashboard:** upload mixes, build playlists, schedule shows, manage adverts, see who's listening. There's a plain-English admin guide.
- **OnTop FM:** support is built and tested with a stand-in station. It plays directly from OnTop FM's own stream, so there's no load on our server, and if it's ever offline it simply shows as offline.
- **Ready for the game:** one station-list address gives your developer everything (names, genres, secure stream links, artwork, what's playing, listener counts). Every player picks their own station independently. Full developer documentation is included.
- **Reliability:** the player reconnects by itself if a stream drops or the server restarts. In a load test, 1,000 simultaneous listeners all got full-quality audio with no drops.

**To go live, I need from you**
1. **Approval** of the setup and hosting: an OVH UK server, about £17/month + VAT, unlimited traffic.
2. **A domain name** for the radio, e.g. radio.yourdomain.com.
3. **OnTop FM's stream address**, plus written permission from the owner.
4. **Real content:** the first DJ mixes, adverts and station logos. Also confirm one advert break roughly every hour is right.
5. **Licensing:** public broadcast of commercial music in the UK needs PPL and PRS for Music licences. I've prepared a description of how the service works that you can send them.
6. **A quick sign-off** that on iPhone, volume is controlled with the phone's buttons. That's an Apple rule for every web player; mute works everywhere.

Once I have the server and domain, setup takes about an hour. Then we'll do a final check on real iPhones and Android phones before launch.

Happy to walk you through it on a call.

Best regards,
[Your name]
