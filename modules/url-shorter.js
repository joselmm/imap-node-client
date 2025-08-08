import fetch from "node-fetch";

export async function shortUrl(url) {
    try {

        var response = await fetch("https://www.shorturl.at/shortener.php", {
            "headers": {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "en-US,en;q=0.9,es-CO;q=0.8,es;q=0.7",
                "cache-control": "max-age=0",
                "content-type": "application/x-www-form-urlencoded",
                "priority": "u=0, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "upgrade-insecure-requests": "1"
            },
            "referrer": "https://www.shorturl.at/",
            "body": "u=" + encodeURIComponent(url),
            "method": "POST",
            "mode": "cors",
            "credentials": "include"
        });
        // console.log(response)
        var text = await response.text();
        console.log(text)
        var match = text.match(/"https:\/\/shorturl.at\/[^"]+"/g);
        var result = match!==null ? match[0].slice(1,-1) : null;
        console.log("resultado de acortador:"+result)
        return result
    } catch (error) {
        return null
    }

}

// shortUrl("https://es.wikipedia.org/wiki/Manuela_(telenovela_colombiana)")