import express from 'express';
import sql from 'mssql';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import open from 'open';
import axios from 'axios';
import notifier from 'node-notifier';
import path from 'path';
import { db } from './firebase.js'; // Firebase yapılandırmasının olduğu dosyadan db'yi içe aktarın
import { collection, query, where, orderBy, limit, getDocs, writeBatch, doc } from "firebase/firestore";
import nodemailer from 'nodemailer';

const app = express();
const port = 3000;
// const port = process.env.PORT || 3000;

import cors from 'cors';  // CORS paketini dahil et

// CORS'u etkinleştir
app.use(cors());

let amount = 10; // X dolarlık coin alınacak anlamına geliyor.
let leverage = 10; // kaldıraç 20 üstüne çıkartma! -> 15x ideal görünüyor.
let profit_rate = 0.01; //0.15 => %15 kar oranı (her al&sat işleminden elde edilecek kar oranıdır.)
let emir_sayisi = 50
let alinabilir_max_coin_sayisi = 1
let tickSize_stepSize_list = []
let ignored_coin_list = []
let coin_market_cap_api_key = "ec2e891f-5007-49ed-895b-726a83728aaf" //"408297cf-3642-4237-b036-35e4e81baa33";
let limit_marketcap = 200;
let trading_status = 0
let satilmayi_bekleyen_coin_sayisi = 0;


// SQL Server bağlantı ayarları
const config = {
    user: 'test3',      // SQL Server kullanıcı adı
    password: 'fb190719',           // SQL Server şifresi
    server: 'DESKTOP-F7E86LQ',       // Sunucu adı
    database: 'cuneyt',      // Veritabanı adı
    options: {
        encrypt: false,              // Yerel SQL Server için şifreleme kapalı olabilir
        trustServerCertificate: true, // Şifreleme devre dışı ise güvenilir sertifika
        enableArithAbort: true       // Uyarıyı gidermek için bu ayarı ekleyin
    }
};

setInterval(async () => {
    try {
        const response = await axios.get('https://rsi-sven.onrender.com/health');
        // console.log(`Health Check: ${response.status}`);
    } catch (err) {
        console.error('Ping failed:', err.message);
    }
}, 300000);

async function get_trading_status() { // status_id=1 ise trading açık demektir, 0 ise kapalı
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query('SELECT * FROM trade');
        
        // İlk satırdaki status_id değerini al
        // status_id=1 ise trading açık demektir, 0 ise kapalı
        const status_id = result.recordset[0].status_id;
        await sql.close();
        return status_id
    } 
    catch (err) {
        console.error('Veritabanı hatası aldığımız için trading_status=0 yani trading açık bot devam edecek demektir HATA: ', err);
        return 1 // 1: trading kapalı demektir
    }
}

async function insertRsiData(json) {
    try {
        const insertDateTime = new Date();
        
        // Koleksiyon referansı
        const collectionRef = collection(db, "coin_rsi");
        
        // Batch işlemi başlatılıyor
        const batch = writeBatch(db);
        
        // JSON verisini batch işlemi ile Firestore'a ekleyin
        for (let i = 0; i < json.length; i++) {
            const docRef = doc(collectionRef); // Otomatik ID oluşturulacak
            batch.set(docRef, {
                coin_name: json[i].coin_name,       // Coin adı
                rsi: json[i].rsi,                  // RSI değeri
                insert_date_time: insertDateTime,   // Ekleme zamanı
                atr_degisim: json[i].atr_degisim,
                rank: json[i].rank, //market cap sırası
            });
        }

        // Batch işlemini Firestore'a uygulayın
        await batch.commit();
        
        // console.log("Veriler Firestore'a başarıyla eklendi.");
    } catch (err) {
        console.error("Firestore ekleme hatası:", err);
    }
}


app.get('/health', (req, res) => {
    res.send('OK');
});


app.get('/get-rsi-data', async (req, res) => {
    try {
        const coinRsiRef = collection(db, "coin_rsi");

        // 1. Adım: En son eklenen belgenin insert_date_time değerini al
        const latestQuery = query(
            coinRsiRef,
            orderBy("insert_date_time", "desc"),
            limit(1)
        );
        const latestSnapshot = await getDocs(latestQuery);

        if (latestSnapshot.empty) {
            return res.status(404).send("Kayıt bulunamadı");
        }

        const latestDoc = latestSnapshot.docs[0];
        const latestDateTime = latestDoc.data().insert_date_time;

        // 2. Adım: Bu insert_date_time değeriyle diğer belgeleri filtrele
        const filteredQuery = query(
            coinRsiRef,
            where("insert_date_time", "==", latestDateTime)
        );
        const filteredSnapshot = await getDocs(filteredQuery);

        if (filteredSnapshot.empty) {
            return res.status(404).send("Belirtilen tarih ve saate göre kayıt bulunamadı");
        }

        // Gelen verileri JSON formatına dönüştür
        const data = filteredSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        // console.log(new Date().toLocaleTimeString() + " - get-rsi-data request geldi: " + data.length)

        res.json(data); // Filtrelenen tüm kayıtları döndür
    } catch (err) {
        console.error("Firestore hatası:", err);
        res.status(500).send("Veritabanı hatası");
    }
});












let tp_order_id_list = []
let buy_order_id_list = []

let ozel_liste = ["QUICKUSDT","MOODENGUSDT","NEARUSDT","RNDRUSDT","GRTUSDT","GALAUSDT","FETUSDT","AGIXUSDT","ROSEUSDT","OCEANUSDT","ARKMUSDT","MANAUSDT","SANDUSDT","ENJUSDT","SOLUSDT","LINKUSDT","PYTHUSDT","WLDUSDT","TIAUSDT","PIXELUSDT","IOTXUSDT"]

import Binance from 'node-binance-api';
const binance = new Binance().options({
    APIKEY: 'BXL5lvixqVEZY5EsTjO54xqjan42kJPUd6547oKmtPoc9YD3AoHvuWQ4K50cinux', //cüneyt
    APISECRET: 'pmYUkQLgyKj959aoxvjtKojqT2xzO4pWfHpTeGDsTwXk4QyEz39CQasv3eK1ju6P', //cüneyt
    // APIKEY: 'KoankrgkpVEp6u6dljT7AebXNo5nhbW07ovdDCWpxXDfrLp1mrIbNLtnpeGTJRID', //ergün
    // APISECRET: 'RgEd5U38P6Ykoah66uCljBKRLiGDDOIGFqsNdEdABHaGVVF5ORsgKZysPgqAGydc', //ergün
    
    'recvWindow': 10000000,
    baseUrl: "http://https://rsi-vwtw.onrender.com"
});

// JSON ve URL-encoded verileri işlemek için:
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let buy_count = 0;
let coin_list = [];
let coin_arr = [];
let taranan_coin_sayisi = 0
let json = []
let coin_market_cap = []
let sum_rsi = 0
let count_rsi = 0

get_coin_list_and_market_cap();
async function get_coin_list_and_market_cap() {
    while (true) {
        coin_market_cap = await get_all_market_ranks();
        await bekle(60*60*12);
        coin_list = await coinler();
    }
}


start_bot();
async function start_bot(){
    
    coin_list = await coinler();
    console.log(new Date().toLocaleTimeString() + " - başladı. coin sayısı: " + coin_list.length)

    while (true) {
        await bekle_60dk();
        

        json = []
        taranan_coin_sayisi = 0

        let btc_data = await saat_calculate_indicators("BTCUSDT");
        let btc_rsi = parseFloat(btc_data[btc_data.length-2]['rsi'])

        for(let i=0;i<coin_list.length;i++){
            coin_tarama(coin_list[i])
            await bekle(0.01)
        }

        while (taranan_coin_sayisi<coin_list.length) {
            await bekle(0.1)
        }

        let ortalama_rsi = sum_rsi/count_rsi;
        let saat = new Date(new Date().setHours(new Date().getHours() + 3)).toLocaleTimeString(); // Şu anki Türkiye saati (sunucuda 3 saat geriden geliyor diye bu şekilde 3 saat ileri aldım)
        console.log(saat + " - saatlik tarama bitti. Bitcoin RSI: " + btc_rsi.toFixed(2) + " - Piyasa Ort. RSI: " + ortalama_rsi.toFixed(2));

        if((btc_rsi<30 && ortalama_rsi<30) || (btc_rsi>70 && ortalama_rsi>70)){
            // firestore veritabanına kayıt olan kişilerin e-posta adreslerine mail gönderme kodu eklenecek. 22.02.2025
            send_mail_cuneyt(saat + " - Mobil Uygulama RSI Sinyali", "Bitcoin RSI: " + btc_rsi.toFixed(2) + "\nPiyasa Ort. RSI: " + ortalama_rsi.toFixed(2))
        }

        await insertRsiData(json);
    }

}


async function emir_diz(coin_name) {

    let baslangic_fiyati = await get_entryPrice(coin_name)
    let kar_rate = profit_rate //0.01 = %1 aralıklı emir dizecek.
    
    //aşağıdan alım emirleri oluşturuluyor.
    for(let i=1; i<=emir_sayisi; i++){
        let kar_orani = i*kar_rate
        limit_buy_emri_with_profit_rate(coin_name, baslangic_fiyati, kar_orani)
    }

}

async function coin_tarama(coin_name) {
    
    let data = await saat_calculate_indicators(coin_name);

    if (data === null || typeof data === 'undefined' || data.length<100) {
        taranan_coin_sayisi++
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + taranan_coin_sayisi)
        return
    }
    else{

            let rsi = parseFloat(data[data.length-2]['rsi'])
            let atr_degisim = parseFloat(data[data.length-2]['atr_degisim'])
            // let rsi_2 = parseFloat(data[data.length-3]['rsi'])
            // let closePrice = parseFloat(data[data.length-2]['close'])
            sum_rsi += rsi;
            count_rsi++;

        try {    
            let coin_mcap = coin_market_cap.filter(item => item.coin_name == coin_name);
            let rank = coin_mcap[0]?.rank || null; // Rank bilgisini kontrol et
            
            json.push({
                "coin_name": coin_name,
                "rsi": parseFloat(rsi.toFixed(2)),
                "atr_degisim": atr_degisim,
                "rank": rank,
            });
        } 
        catch (error) {
            console.log(new Date().toLocaleTimeString() + " - coin_tarama() içinde hata: " + error)
        }
        finally{
            taranan_coin_sayisi++
        }

    }

}


async function get_breakEvenPrice(symbol) {
    try {
        // Pozisyon bilgilerini çek
        const positions = await binance.futuresPositionRisk();
        
        // İlgili coin çifti için pozisyonu bul
        const position = positions.find(pos => pos.symbol === symbol);

        if (position.positionAmt == 0) {
            console.log('Açık pozisyon bulunamadı!');
            return 0;
        }
        else{
            return position.breakEvenPrice
        }
    } catch (error) {
        console.error('Hata:', error);
    }
}

// Son 24 saatte en çok yükselen USDT çiftlerini döndüren fonksiyon
async function getTopGainersUSDT() {
    try {
        // Binance'ten 24 saatlik değişim bilgilerini al
        const tickers = await binance.futuresDaily();

        // Ticker bilgilerini diziye çevir
        const tickersArray = Object.values(tickers);

        // USDT çiftlerini filtrele
        const usdtTickers = tickersArray.filter(coin => coin.symbol.includes('USDT'));

        // Yüzde değişime göre sırala
        const sortedTickers = usdtTickers.sort(
            (a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)
        );

        // En çok yükselen ilk 5 USDT çiftini seç
        const top5USDT = sortedTickers.slice(0, 5);

        // Symbol değerlerini bir liste olarak döndür
        return top5USDT.map(coin => coin.symbol);
    } catch (error) {
        console.error('Veri alınırken hata oluştu:', error.message);
        return [];
    }
}


async function countLimitSellOrders(coin_name) { //openOrders sekmesinde açık olan "LIMIT SELL" emirlerinin sayısını verir.
    try {
        // Açık emirleri al
        const orders = await binance.futuresOpenOrders(coin_name);

        // Şartları sağlayan nesneleri filtrele ve sayısını bul
        const count = orders.filter(order => order.type === 'LIMIT' && order.side === 'SELL').length;

        console.log(`${coin_name} LIMIT SELL emir sayısı:`, count);
        return count;
    } 
    catch (error) {
        console.error('Hata:', error);
    }
}

// Bildirim gönder
function bildirimGonder(title, message, side) {
    let image_path = null

    if(side == "buy"){
        image_path = 'D:\\buy.png'
    }
    else if(side == "sell"){
        image_path = 'D:\\sell.png'
    }
    else{
        image_path = 'D:\\bildirim.png'
    }

    notifier.notify(
        {
            title: title,
            message: message,
            icon: image_path, // Resim dosyasının yolu
            sound: true,
            wait: false,
            appID: 'Grid v4.1' // Uygulama adı
        },
        function (err, response) {
            if (err) console.error("Bildirim hatası:", err);
        }
    );
}

async function garbage_collector_baslat(){
    while (true) {
        await bekle_60dk();
        if(global.gc){
            global.gc();
        }
        else{
            console.log('Garbage collection not available. Set --expose-gc when launching Node.');
        }
    }
}

async function amount_hesapla(){
    let current_balance = await get_balance()
    let amount = parseFloat((current_balance/alinabilir_max_coin_sayisi/7).toFixed(2)) // 5: her coin en fazla %50 terste kalabilir.
    return amount;
}


async function get_volume_marketcap() {
    try {
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=' + limit + "&sort_dir=desc", {
            headers: {
                'X-CMC_PRO_API_KEY': coin_market_cap_api_key,
            },
        });

        if (response.status !== 200) {
            throw new Error('API isteği başarısız oldu: ' + response.status);
        }

        const json = response.data;
        let list = []
        // console.log('Alınan veri:', json);
        for(let i=0;i<json.data.length;i++){
            list.push({'coin_name':json.data[i].symbol, 'volume_24h': json.data[i].quote.USD.volume_24h, 'market_cap':json.data[i].quote.USD.market_cap,'volume_mcap_rate': json.data[i].quote.USD.volume_24h/json.data[i].quote.USD.market_cap})
            // console.log(json.data[i].symbol + "\t\t" + (json.data[i].quote.USD.volume_24h/json.data[i].quote.USD.market_cap).toFixed(2) + "\t\t\t" + json.data[i].cmc_rank + "\t\t\t" + json.data[i].quote.USD.volume_change_24h.toFixed(2) + "\t\t\t\t" + json.data[i].quote.USD.percent_change_24h.toFixed(2))
        }
        return list

        // Diğer işlemleri burada devam ettirin...
    } catch (error) {
        console.error('API isteği başarısız oldu:', error.message);
        throw error;
    }
}

async function get_all_market_ranks() {
    try {
        // API isteğini yap
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=2000&sort_dir=desc', {
            headers: {
                'X-CMC_PRO_API_KEY': coin_market_cap_api_key,
            },
        });

        if (response.status !== 200) {
            console.log('API isteği başarısız oldu: ', response.status);
            return [];
        }

        const json = response.data;

        // Tüm coinlerin adını ve sıralamasını alın
        const ranks = json.data.map(coin => ({
            coin_name: coin.symbol+"USDT",
            rank: coin.cmc_rank,
        }));

        console.log(new Date().toLocaleTimeString() + " - mcap çekildi: " + ranks.length)

        return ranks;

    } catch (error) {
        console.error('API isteği başarısız oldu (status code = 429 ise aylık request hakkı bitmiş demektir): ' + error);
        return [];
    }
}

async function get_market_rank(coin_name) { 
    try {
        // "USDT" kısmını kaldırarak temiz bir coin sembolü elde edelim
        const pure_coin_name = coin_name.replace(/USDT$/i, ''); // Sadece "USDT" kısmını temizler
        
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=5000&sort_dir=desc', {
            headers: {
                'X-CMC_PRO_API_KEY': coin_market_cap_api_key,
            },
        });

        if (response.status !== 200) {
            console.log('API isteği başarısız oldu1: ');
            return -1
        }

        const json = response.data;

        // Coin sembolüyle eşleşen kripto parayı bul
        const coin = json.data.find(coin => coin.symbol.toUpperCase() === pure_coin_name.toUpperCase());
        if (!coin) {
            // console.log(`Coin '${pure_coin_name}' bulunamadı.`);
            return -1
        }

        return coin.cmc_rank;

    } catch (error) {
        console.error('API isteği başarısız oldu2(status code = 429 ise aylık request hakkı bitmiş demektir) HATA: ' + error);
        return -1
    }
}


async function get_btc_funding_rate() {
    let btc_funding_rate = await binance.futuresMarkPrice( "BTCUSDT" ).then(json => json.lastFundingRate*100)
    return btc_funding_rate
}

async function get_all_tickSize_stepSize() {//tek seferde tüm coinlerin tickSize değerini çekmek için kullanılacak.

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {

            for (let i = 0; i < json.symbols.length; i++) {

                let tickSize = null;
                let stepSize = null;
                
                //tickSize => quantity için kullanılacak.
                if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                    tickSize = 0;
                } else {
                    tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                }
                
                //stepSize => price için kullanılacak.
                if(json.symbols[i].filters[2].stepSize.indexOf("1") == 0) {
                    stepSize = 0;
                } else {
                    stepSize = json.symbols[i].filters[2].stepSize.indexOf("1") - 1;
                }

                tickSize_stepSize_list.push({'coin_name': json.symbols[i].symbol, 'tickSize': tickSize, 'stepSize': stepSize});

                //console.log(new Date().toLocaleTimeString() + " - " + i + " - coin_name: " + json.symbols[i].symbol + " - tickSize: " + tickSize + " - stepSize: " + stepSize);
                
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -1err- " + err));

}

async function find_tickSize_price(coin_name){ //bot başlarken çekilen tickSize verileri içinde arama yaparak daha hızlı sonuca ulaşabiliriz.
    for(let i=0; i<tickSize_stepSize_list.length; i++){
        if(tickSize_stepSize_list[i].coin_name == coin_name){
            return tickSize_stepSize_list[i].tickSize;
        }
    }
}

async function find_stepSize_quantity(coin_name){ //bot başlarken çekilen stepSize verileri içinde arama yaparak daha hızlı sonuca ulaşabiliriz.
    for(let i=0; i<tickSize_stepSize_list.length; i++){
        if(tickSize_stepSize_list[i].coin_name == coin_name){
            return tickSize_stepSize_list[i].stepSize;
        }
    }
}

async function btc_rsi() {
    
    //RSI HESAPLAMA İÇİN KULLANILAN DEĞİŞKENLER
    let rsi_period = 14;
    let gain = [], loss = [], change = [];
    let sum_gain = 0, sum_loss = 0, rsi = null;
    let rsi_list = [];
    let closePrice_list = [];
    let minPrice_list = [];
    let maxPrice_list = [];
    
    let nesne = [ //3 elemanlı bir dizi => her elemanı bir json verisi tutuyor.
        {'time': '1m', 'rsi': null},
        {'time': '15m', 'rsi': null},
        {'time': '1h', 'rsi': null},
    ];

    for(let i=0;i<nesne.length;i++){
        
        await binance.futuresCandles("BTCUSDT", nesne[i].time)
        .then(json => {
    
            //RSI hesaplamak için kullanılacak veriler
            for (let i = 1; i < rsi_period + 1; i++) {
                let change_price = (parseFloat(json[i][4]) - parseFloat(json[i - 1][4]))
                change.push(change_price);
                if (change_price >= 0) {
                    gain.push(change_price);
                    loss.push(0);
                    sum_gain += change_price;
                } else {
                    loss.push(change_price);
                    gain.push(0);
                    sum_loss -= change_price;
                }
    
            }
    
            let avg_gain = sum_gain / rsi_period;
            let avg_loss = sum_loss / rsi_period;
            let rs = avg_gain / avg_loss;
            rsi = 100 - (100 / (1 + rs));
            let gecici_list = [] //stokastik rsi %K ve %D hesaplamak için kullanılacak
    
    
            for (let i = rsi_period + 1; i < json.length - 1; i++) {
                let change_price = (parseFloat(json[i][4]) - parseFloat(json[i - 1][4]))
                if (change_price >= 0) {
                    avg_gain = ((avg_gain * (rsi_period - 1)) + change_price) / rsi_period;
                    avg_loss = ((avg_loss * (rsi_period - 1)) + 0) / rsi_period;
                } else {
                    avg_gain = ((avg_gain * (rsi_period - 1)) + 0) / rsi_period;
                    avg_loss = ((avg_loss * (rsi_period - 1)) - change_price) / rsi_period;
                }
                rs = avg_gain / avg_loss;
                rsi = 100 - (100 / (1 + rs));
                rsi_list.push(rsi);
                closePrice_list.push(json[i][4]);
                minPrice_list.push(json[i][3]);
                maxPrice_list.push(json[i][2]);
    
                if (i > json.length - 20) { //bu if koşulundakiler, stokastik rsi %K ve %D hesaplamak için kullanılacak
                    gecici_list.push(rsi);
                }
            }
    
        })

        nesne[i].rsi = parseFloat(rsi).toFixed(2);

    }
    

    return nesne;


}




async function calculate_adx(coin_name) {
    
    let data = [];
    let period = 14;
    
    await binance.futuresCandles(coin_name, '1h')
    .then(json => {
        for(let i=0;i<json.length;i++){
            data.push({
                'open_time': parseFloat(json[i][0]),
                'open_price': parseFloat(json[i][1]),
                'high_price': parseFloat(json[i][2]),
                'low_price': parseFloat(json[i][3]),
                'close_price': parseFloat(json[i][4]),
                'volume': parseFloat(json[i][5]),
                'close_time': parseFloat(json[i][6]),
                'true_range': null, //ATR hesaplamak için kullanılacak.
                'atr': null, 
                'high_prevHigh': null, //adx hesaplamada kullanılacak. High - Previous High
                'prevLow_low': null, //adx hesaplamada kullanılacak. Previous Low -  Low
                'positive_dx': null,
                'negative_dx': null,
                'smooth_positive_dx': null,
                'smooth_negative_dx': null,
                'positive_dmi': null,
                'negative_dmi': null,
                'dx': null,
                'adx': null,
            })
        }
    })

    //True Range Hesaplama BAŞI
    for(let i=1;i<data.length;i++){
        let high_low = data[i].high_price - data[i].low_price; 
        let high_prevClose = Math.abs(data[i].high_price - data[i-1].close_price);
        let low_prevClose = Math.abs(data[i].low_price - data[i-1].close_price);
        let true_range = Math.max(high_low, high_prevClose, low_prevClose);
        //console.log(high_low + ", \t" + high_prevClose + ", \t" + low_prevClose + " => \t" + true_range)
        data[i].true_range = true_range;


        //ADX hesaplamada kullanılacak veriler alttadır.
        data[i].high_prevHigh = data[i].high_price - data[i-1].high_price;
        data[i].prevLow_low = data[i-1].low_price - data[i].low_price;
        
        if(data[i].high_prevHigh > data[i].prevLow_low && data[i].high_prevHigh > 0)    data[i].positive_dx = data[i].high_prevHigh;
        else data[i].positive_dx = 0;

        if(data[i].prevLow_low > data[i].high_prevHigh && data[i].prevLow_low > 0)      data[i].negative_dx = data[i].prevLow_low;
        else data[i].negative_dx = 0;

    }
    //True Range Hesaplama SONU

    //ATR Hesaplama BAŞI
    let sum_true_range = 0;
    let sum_positive_dx = 0; //adx hesaplamada kullanılacak.
    let sum_negative_dx = 0; //adx hesaplamada kullanılacak.
    
    for(let i=0;i<period;i++){
        sum_true_range += data[i].true_range;
        sum_positive_dx += data[i].positive_dx; //adx hesaplamada kullanılacak.
        sum_negative_dx += data[i].negative_dx; //adx hesaplamada kullanılacak.
    }

    data[period-1].atr = sum_true_range/period;
    data[period-1].smooth_positive_dx = sum_positive_dx/period; //adx hesaplamada kullanılacak.
    data[period-1].smooth_negative_dx = sum_negative_dx/period; //adx hesaplamada kullanılacak.
    data[period-1].positive_dmi = data[period-1].smooth_positive_dx/data[period-1].atr*100; //adx hesaplamada kullanılacak.
    data[period-1].negative_dmi = data[period-1].smooth_negative_dx/data[period-1].atr*100; //adx hesaplamada kullanılacak.
    data[period-1].dx = Math.abs(data[period-1].positive_dmi-data[period-1].negative_dmi)/(data[period-1].positive_dmi+data[period-1].negative_dmi)*100; //adx hesaplamada kullanılacak.

    //ilk atr hesaplaması üstte periyot sayısına göre ortalama alınarak hesaplanıyor. Sonraki ATR değerleri yumuşatılarak alttaki gibi hesaplanıyor.
    for(let i=period;i<data.length;i++){
        data[i].atr = ((data[i-1].atr*(period-1))+data[i].true_range)/period;
        data[i].smooth_positive_dx = ((data[i-1].smooth_positive_dx*(period-1))+data[i].positive_dx)/period; //adx hesaplamada kullanılacak.
        data[i].smooth_negative_dx = ((data[i-1].smooth_negative_dx*(period-1))+data[i].negative_dx)/period; //adx hesaplamada kullanılacak.
        data[i].positive_dmi = data[i].smooth_positive_dx/data[i].atr*100; //adx hesaplamada kullanılacak.
        data[i].negative_dmi = data[i].smooth_negative_dx/data[i].atr*100; //adx hesaplamada kullanılacak.
        data[i].dx = Math.abs(data[i].positive_dmi-data[i].negative_dmi)/(data[i].positive_dmi+data[i].negative_dmi)*100; //adx hesaplamada kullanılacak.
    }
    //ATR Hesaplama SONU

    
    //ADX Hesaplama BAŞI
    let sum_dx = 0;
    for(let i=period-1;i<(2*period)-1;i++){
        sum_dx += data[i].dx;
    }
    data[(2*period)-2].adx = sum_dx/period;

    //ilk adx değeri önceki periyot(14) ortalaması alınır. Sonraki adx değerleri yumuşatılarak alttaki şekilde hesaplanır.
    for(let i=(2*period)-1;i<data.length;i++){
        data[i].adx = ((data[i-1].adx*(period-1))+data[i].dx)/period;
    }
    //ADX Hesaplama SONU
    
    return parseFloat(data[data.length-2].adx);
}














async function dk_calculate_indicators(coin_name){

    let data = await dk_get_data(coin_name)

    // if(data.length<500){
    //     return
    // }

    try {
        await dk_calculate_rsi(data);
        await dk_calculate_atr(data);  
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - calculate_indicators() hata: " + error)
        return
    }

    return data

}


async function dk_get_data(coin_name){
    let data = []
    let durum = true;

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1m", {limit:490})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }

                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == new Date().getMinutes()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name:': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function dk_calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}


async function dk_calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}


async function saat_calculate_indicators(coin_name){

    let data = await saat_get_data(coin_name)
    if (data === null || typeof data === 'undefined' || data.length == 0) {
        return null
    }

    try {
        await saat_calculate_rsi(data);
        await saat_calculate_atr(data);
        // await saat_calculate_stokastik_rsi(data);
        // await saat_calculate_bollinger_band(data);    
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - calculate_indicators() hata: " + error)
        return null
    }

    return data

}
// let get_data_sayisi = 0
async function saat_get_data(coin_name){
    let data = []
    let durum = true;
    // get_data_sayisi++
    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data_sayisi: " + get_data_sayisi)
    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1h", {limit:490})
            .then(json => {
                
                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function saat_calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}

async function saat_calculate_stokastik_rsi(data){
    let period = 14
    for(let i=period*2;i<data.length;i++){
        let rsi = []

        for(let j=0;j<period;j++){
            rsi.push(data[i-j]['rsi'])
        }

        let lowest_rsi = Math.min(...rsi)
        let highest_rsi = Math.max(...rsi)
        data[i]['stokastik'] = ((data[i]['rsi']-lowest_rsi)/(highest_rsi-lowest_rsi))*100
    }

    //stokastik %K altta hesaplanıyor.
    for(let i=(period*2)+3;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik']
        }
        data[i]['stokastik_k'] = sum/3
    }

    //stokastik %D altta hesaplanıyor.
    for(let i=(period*2)+6;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik_k']
        }
        data[i]['stokastik_d'] = sum/3
    }
}

async function saat_calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}

async function saat_calculate_bollinger_band(data){
    let period = 200;
    let upper_muptiplier=2;
    let lower_muptiplier=2;

    for(let i=period-1;i<data.length;i++){
        let sum=0;
        for(let k=i;k>i-period;k--){
            sum += data[k]['close']
        }
        data[i]['bb_sma'] = sum/period
        


        //farklarının karesini topla
        let square_sum=0;
        for(let k=i;k>i-period;k--){
            square_sum += Math.pow(data[k]['close']-data[i]['bb_sma'],2)
        }

        data[i]['bb_standart_sapma'] = Math.sqrt(square_sum/(period))
        data[i]['bb_upper'] = data[i]['bb_sma'] + (data[i]['bb_standart_sapma']*upper_muptiplier)
        data[i]['bb_lower'] = data[i]['bb_sma'] - (data[i]['bb_standart_sapma']*lower_muptiplier)
        data[i]['bbw'] = (data[i]['close'] - data[i]['bb_lower']) / (data[i]['bb_upper'] - data[i]['bb_lower'])
        // console.log("lower: " + data[i]['bb_lower'] + " - upper: " + data[i]['bb_upper'])
    }

}


async function get_data(coin_name){
    let data = []
    let durum = true;

    try {

        while (durum == true) {
            
            await binance.futuresCandles(coin_name, "1h", {limit:490})
            .then(json => {
                // if (!(json && json.length > 0)){
                //     console.log(new Date().toLocaleTimeString() + " - hata: " + coin_name + " - json tanımlı değil.")
                //     durum == false
                //     return
                // }

                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours()){
                    durum = false;
                    //json[json.length-1][1] = openPrice
                    //json[json.length-1][2] = maxPrice
                    //json[json.length-1][3] = minPrice
                    //json[json.length-1][4] = closePrice

                    for(let i=0;i<json.length;i++){
                        data.push({
                            'coin_name:': coin_name,
                            'open': parseFloat(json[i][1]), 
                            'high': parseFloat(json[i][2]), 
                            'low': parseFloat(json[i][3]), 
                            'close': parseFloat(json[i][4]), 
                            'volume': parseFloat(json[i][5]), 
                            'date': new Date(json[i][6]).toLocaleDateString(), 
                            'time': new Date(json[i][6]).toLocaleTimeString(),
                            'saat': new Date(json[i][6]).getHours()
                        })
                    }

                } 
                else {
                    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + new Date(json[json.length - 1][6]).getHours() + " == " + new Date().getHours() + ", " +  new Date(json[json.length - 1][6]).getMinutes() + " == " + (new Date().getMinutes() + 59))
                    durum = true;
                }   
            })

            if (durum == true) {
                await bekle(1);
            }

        }
    } 
    catch (error) {
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - get_data() hata: " + error)
        return null
    }

    // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - data.length: " + data.length)
    return data
}

async function calculate_rsi(data){

    let rsi_period = 14

    for(let i=1;i<data.length;i++){
        
        if(data[i]['close']>data[i-1]['close']){
            data[i]['upward_movement']=data[i]['close']-data[i-1]['close']
            
        }
        else{
            data[i]['upward_movement']=0
        }

        if(data[i]['close']<data[i-1]['close']){
            data[i]['downward_movement']=data[i-1]['close']-data[i]['close']
        }
        else{
            data[i]['downward_movement']=0
        }
    }


    let sum_upward=0
    let sum_downward=0

    for(let i=rsi_period;i>0;i--){
        sum_upward += data[i]['upward_movement']
        sum_downward += data[i]['downward_movement']
    }

    data[rsi_period]['average_upward_movement']=sum_upward/rsi_period
    data[rsi_period]['average_downward_movement']=sum_downward/rsi_period
    data[rsi_period]['relative_strength']=data[rsi_period]['average_upward_movement']/data[rsi_period]['average_downward_movement']
    data[rsi_period]['rsi']=100-(100/(data[rsi_period]['relative_strength']+1))

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['average_upward_movement']=((data[i-1]['average_upward_movement']*(rsi_period-1))+data[i]['upward_movement'])/rsi_period
        data[i]['average_downward_movement']=((data[i-1]['average_downward_movement']*(rsi_period-1))+data[i]['downward_movement'])/rsi_period
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['relative_strength']=data[i]['average_upward_movement']/data[i]['average_downward_movement']
    }

    for(let i=rsi_period+1;i<data.length;i++){
        data[i]['rsi']=100-(100/(data[i]['relative_strength']+1))
    }
    
}

async function calculate_stokastik_rsi(data){
    let period = 14
    for(let i=period*2;i<data.length;i++){
        let rsi = []

        for(let j=0;j<period;j++){
            rsi.push(data[i-j]['rsi'])
        }

        let lowest_rsi = Math.min(...rsi)
        let highest_rsi = Math.max(...rsi)
        data[i]['stokastik'] = ((data[i]['rsi']-lowest_rsi)/(highest_rsi-lowest_rsi))*100
    }

    //stokastik %K altta hesaplanıyor.
    for(let i=(period*2)+3;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik']
        }
        data[i]['stokastik_k'] = sum/3
    }

    //stokastik %D altta hesaplanıyor.
    for(let i=(period*2)+6;i<data.length;i++){
        let sum=0
        for(let j=0;j<3;j++){
            sum += data[i-j]['stokastik_k']
        }
        data[i]['stokastik_d'] = sum/3
    }
}

async function calculate_atr(data){
    //atr hesaplama başı
    let atr=null
    let atr_period=14
    let toplam_tr = 0;
    let first_tr = data[0]['high'] - data[0]['low']
    toplam_tr += first_tr;

    for (let i = 1; i < atr_period; i++) {
        let tr1 = data[0]['high'] - data[0]['low']
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let max_tr = Math.max(tr1, tr2, tr3);
        toplam_tr += max_tr;
    }

    atr = toplam_tr / atr_period; //14.satırdaki average true range değeri

    for (let i = atr_period; i < data.length; i++) {
        let tr1 = data[i]['high'] - data[i]['low'];
        let tr2 = Math.abs(data[i]['high'] - data[i-1]['close']);
        let tr3 = Math.abs(data[i]['low'] - data[i-1]['close'])
        let current_atr = Math.max(tr1, tr2, tr3);

        atr = ((atr * (atr_period - 1)) + current_atr) / atr_period;
        data[i]['atr'] = atr
        data[i]['atr_degisim'] = atr / data[i]['close'] * 100
    }
    //atr hesaplama sonu
}



async function hata_maili_gonder(hata) {
    let konu = new Date().toLocaleTimeString() + " CÜNEYT 1dk BOTU DURDU! Manuel Kontrol Edilecek.";
    let mesaj = hata;
    await send_mail_cuneyt(konu, mesaj);

    await bekle(3);
    process.exit(1);
}



async function get_tickSize(coin_name) {
    let tickSize = null;

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -1err- " + err));

    return tickSize;
}

async function get_stepSize(coin_name) {

    const coins = await binance.futuresExchangeInfo()
        .catch(err => console.log(new Date().toLocaleTimeString() + " -2err- " + err));

    let t = 0;
    for (t = 0; t < coins.symbols.length; t++) {
        if (coins.symbols[t].pair == coin_name) {
            break;
        }
    }

    const json = coins.symbols[t];
    let stepSize; //quantity için stepSize kullanılır.

    if (json.filters[2].stepSize.indexOf("1") == 0) {
        stepSize = 0;
    } else stepSize = json.filters[2].stepSize.indexOf("1") - 1;

    return stepSize;

}





async function saatlik_takip(coin_name){

    while (true) {
        await bekle_60dk();
        let bekleyen_coinler = await get_bekleyen_list("saatlik_takip()")
        if (bekleyen_coinler.includes(coin_name)) { //satılmayı bekleyen coinler arasında bu coin VARSA;
            
            let data = await saat_calculate_indicators(coin_name);
            if (data === null || typeof data === 'undefined' || data.length == 0) {
                console.log(new Date().toLocaleTimeString() + " - saatlik_takip() - " + coin_name + " - data yok")
                continue   
            }

            let btc_data = await saat_calculate_indicators("BTCUSDT");
            let btc_rsi = btc_data[btc_data.length-2]['rsi']

            let entryPrice = await get_entryPrice(coin_name);
            let rsi = data[data.length-2]['rsi']
            let closePrice = data[data.length-2]['close']
            let degisim = (closePrice-entryPrice)/entryPrice*100;
            // let breakEvenPrice = await get_breakEvenPrice(coin_name)
            
            if( rsi>67 || /*(rsi>60 && btc_rsi>70 && degisim>0) || */degisim>2 ){
                await long_marketSell_order(coin_name);
                await cancel_all_orders(coin_name);
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - saatlik_takip(), rsi satışı yapıldı. RSI: " + rsi.toFixed(2) + " - btc_rsi: " + btc_rsi.toFixed(2) + " - Değişim: " + degisim.toFixed(2));
                await bekle(10)
                alinabilir_max_coin_sayisi++
                return
            }
            else{
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - saatlik takip raporu, RSI: " + rsi.toFixed(2) + " - btc_rsi: " + btc_rsi.toFixed(2) + " - degisim: " + degisim.toFixed(2))
            }

            /*if(rsi>67){
                send_mail_cuneyt(new Date().toLocaleTimeString() + " - RSI>67 SINYAL - " + coin_name, "RSI: " + rsi.toFixed(2))
                open('D:\\horoz_alarm.mp4');
            }*/
            
        }
        else{
            await cancel_all_orders(coin_name);
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - saatlik_takip() - Bu coine ait açık pozisyon yok. Bot sonlandırıldı.");
            await bekle(10)
            alinabilir_max_coin_sayisi++
            return
        }
        
    }

}


async function long_marketBuy(coin_name, lastPrice){
    let stepSize = await find_stepSize_quantity(coin_name);
    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -42err- " + err)); //kaldıraç
    // await binance.futuresMarginType(coin_name, 'ISOLATED').catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    await binance.futuresMarginType(coin_name, 'CROSSED')/*.then(json => console.log(json))*/.catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    
    
    var y = amount * leverage / lastPrice
    var quantity = parseFloat(y.toFixed(stepSize))

    let json = await binance.futuresMarketBuy(coin_name, quantity)
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketBuy() içindeki futuresMarketBuy request hatası: ' + err))

    if (json.status == 'NEW' || json.status == "FILLED") { //futuresMarketBuy işlemi başarılı
        console.log(new Date().toLocaleTimeString() + ' - ' + (++buy_count) + ' - ' + coin_name + ', LONG MARKET BUY ORDER gerçekleşti.');
        saatlik_takip(coin_name);
        emir_diz(coin_name);

        //Alım yapılan market fiyatına ulaşıyoruz ve %1 yukarısına tp emri koyuyoruz.
        /*let orderDetails = await binance.futuresOrderStatus(coin_name, { orderId: json.orderId });
        let buy_price = orderDetails.avgPrice
        long_sell_order(coin_name, buy_price, quantity)*/
    }
    else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", futuresMarketBuy() işlemi yaparken HATA verdi => " + json.msg)
    }

    return json;
}

async function mail_olustur(side, bb, json){
    await bekle(50);
    let btc_data = await btc_rsi();
    //let btc_adx = await calculate_adx("BTCUSDT");
    //let hacim = await get_volume(bb.coin_name);
    let adx_diff = bb.adx_2-bb.adx;
    let rsi_diff = Math.abs(bb.rsi - bb.rsi_2);

    if(side == "short"){
        let konu = new Date().toLocaleTimeString() + " +1h CÜNEYT+ " + bb.coin_name + " + RSI SHORT";
        let mesaj = "RSI: " + parseFloat(bb.rsi).toFixed(2) + "\nATR DEĞİŞİM: " + bb.atr_degisim.toFixed(2) + "\nADX: " + parseFloat(bb.adx).toFixed(2) + "\nADX_2: " + parseFloat(bb.adx_2).toFixed(2) + "\nDegisim(%): " + parseFloat(bb.degisim).toFixed(2) + "\nStokastik %K: " + parseFloat(bb.stokastik_rsi).toFixed(2) + " \nSondan 2. Stokastik %K: " + parseFloat(bb.stokastik_rsi_2).toFixed(2) + " \nBB%B: " + bb.bb_yuzde.toFixed(2) + "\nMFI: " + bb.mfi + "\nWilliams %R: " + bb.williams_r + "\nBTC RSI 1m: " + btc_data[0].rsi + "\nBTC RSI 15m: " + btc_data[1].rsi + "\nBTC RSI 1h: " + btc_data[2].rsi + "\nSMA(200): " + bb.sma + "\nlastPrice: " + bb.closePrice;
        send_mail_cuneyt(konu, mesaj);
    }
    else if(side == "long"){
        let konu = new Date().toLocaleTimeString() + " +1h CÜNEYT+ " + bb.coin_name + " + RSI LONG";
        let mesaj = "RSI: " + parseFloat(bb.rsi).toFixed(2) + "\nATR DEĞİŞİM: " + bb.atr_degisim.toFixed(2) + "\nADX: " + parseFloat(bb.adx).toFixed(2) + "\nADX_2: " + parseFloat(bb.adx_2).toFixed(2) + "\nDegisim(%): " + parseFloat(bb.degisim).toFixed(2) + "\nStokastik %K: " + parseFloat(bb.stokastik_rsi).toFixed(2) + " \nSondan 2. Stokastik %K: " + parseFloat(bb.stokastik_rsi_2).toFixed(2) + " \nBB%B: " + bb.bb_yuzde.toFixed(2) + "\nMFI: " + bb.mfi + "\nWilliams %R: " + bb.williams_r + "\nBTC RSI 1m: " + btc_data[0].rsi + "\nBTC RSI 15m: " + btc_data[1].rsi + "\nBTC RSI 1h: " + btc_data[2].rsi + "\nSMA(200): " + bb.sma + "\nlastPrice: " + bb.closePrice;
        send_mail_cuneyt(konu, mesaj);
    }
    else{
        console.log(new Date().toLocaleTimeString() + " hatalı side gönderildi: " + side)
    }
}

async function get_volume(coin_name){ //ortalama hacim koşulu koymak için kullanılacak. 10.07.2023
    let sum_volume_3day = 0;
    let sum_volume_10day = 0;
    let sum_volume_30day = 0;
    let average_volume_3day = null;
    let average_volume_10day = null;
    let average_volume_30day = null;

    await binance.futuresCandles(coin_name, "1d")
    .then(json => {

        //sinyal geldiği mumu hesaba katmıyoruz. 3 günlük hacim ortalması
        for(let i=json.length-1-3; i<json.length-1; i++){
            sum_volume_3day += parseFloat(json[i][7]);
        }
        average_volume_3day = sum_volume_3day/3;

        //sinyal geldiği mumu hesaba katmıyoruz. 10 günlük hacim ortalması
        for(let i=json.length-1-10; i<json.length-1; i++){
            sum_volume_10day += parseFloat(json[i][7]);
        }
        average_volume_10day = sum_volume_10day/10;


        //sinyal geldiği mumu hesaba katmıyoruz. 30 günlük hacim ortalması
        for(let i=json.length-1-30; i<json.length-1; i++){
            sum_volume_30day += parseFloat(json[i][7]);
        }
        average_volume_30day = sum_volume_30day/30;

    }).catch(err => console.log(coin_name + " - get_volume() HATA: " + err))

    return{
        'ort_3gun': average_volume_3day,
        'ort_10gun': average_volume_10day,
        'ort_30gun': average_volume_30day,
        'oran_3_30': parseFloat(average_volume_3day / average_volume_30day * 100).toFixed(2),
        'oran_10_30': parseFloat(average_volume_10day / average_volume_30day * 100).toFixed(2),
    }
}

async function satildi_mi_takip(coin_name){
    while (true) {
        let bekleyen_coinler = await get_bekleyen_list("satildi_mi_takip fonksiyonu");
        if (!bekleyen_coinler.includes(coin_name)) {
            let profit = await get_profit();
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - satıldı. " + profit);
            await cancel_all_orders(coin_name);
            return;
        }
        else{
            await bekle(35);
        }
    }
}

async function long_limit_sell_order(coin_name) { //giriş fiyatına limit order oluşturur.
    let quantity = await get_quantity(coin_name);
    let tickSize = null;

    let entryPrice = await get_entryPrice(coin_name);

    //ticksize bilgisi alınıyor.
    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -3err- " + err));

    //TAKE PROFIT ORDER veriyoruz.
    await binance.futuresSell(coin_name, quantity, entryPrice, { reduceOnly: true, 'recvWindow': 10000000 })
        .then(json => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + entryPrice + " fiyatından LONG SELL ORDER(entryPrice) verildi.");

            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", long_limit_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -4err- " + err));
}

async function short_limit_sell_order(coin_name) { //giriş fiyatına limit order oluşturur.
    let quantity = await get_quantity(coin_name);
    let tickSize = null;

    let entryPrice = await get_entryPrice(coin_name);

    await binance.futuresExchangeInfo()
        .then(json => {
            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].symbol == coin_name) {
                    if (json.symbols[i].filters[0].tickSize.indexOf("1") == 0) {
                        tickSize = 0;
                    } else {
                        tickSize = json.symbols[i].filters[0].tickSize.indexOf("1") - 1;
                    }

                    break;
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -5err- " + err));


    //TAKE PROFIT değerini giriyoruz.
    await binance.futuresBuy(coin_name, quantity, entryPrice, { reduceOnly: true, 'recvWindow': 10000000 })
        .then((json) => {

            if (json.status == 'NEW') { //futuresBuy işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + entryPrice + " fiyatından SHORT SELL ORDER(entryPrice) verildi.");

            }
            else if (json.code < 0) { //futuresBuy işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", short_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -6err- " + err));
}




async function coin_arr_bul(coin_name) {
    let coin = null;

    while (true) {
        coin_arr.map(item => {
            if (item.coin_name == coin_name) {
                coin = item;
            }
        })

        if (coin != null) {
            return coin;
        }
        else {
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - coin_arr_bul() fonksiyonunda null döndürdüğü için tekrar deneyecek.");
            await bekle(1);
        }
    }
}

async function short_marketSell_order(coin_name) { //short pozisyondaki order için market fiyatına satan fonksiyon
    let guncel_quantity = await get_quantity(coin_name);

    await binance.futuresMarketBuy(coin_name, guncel_quantity, { reduceOnly: true })
        .then((json) => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', market fiyatına satıldı.');
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", SHORT MARKET SELL HATASI:  => " + json.msg);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - short_marketSell_order() requestinde hata var: ' + err))
}

async function long_marketSell_order(coin_name) { //short pozisyondaki order için market fiyatına satan fonksiyon
    let guncel_quantity = await get_quantity(coin_name);

    await binance.futuresMarketSell(coin_name, guncel_quantity, { reduceOnly: true })
        .then((json) => {

            if (json.status == 'NEW') { //futuresMarketSell işlemi başarılı 
                console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', market fiyatına satıldı.');
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", LONG MARKET SELL HATASI:  => " + json.msg);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketSell_order() requestinde hata var: ' + err))
}

async function get_likitPrice(coin_name) {
    let likit_price = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return parseFloat(json[i].liquidationPrice);
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", likit price çekerken hata: " + err));

    return likit_price;
}

async function get_degisim(coin_name) {
    let durum = true;
    let degisim = null;

    while (durum == true) {

        degisim = await binance.futuresCandles(coin_name, "1h")
            .then(json => {
                //json[json.length-1][1] = openPrice
                //json[json.length-1][2] = maxPrice
                //json[json.length-1][3] = minPrice
                //json[json.length-1][4] = closePrice

                //yeni mum aktif olup olmadığını anlamak için json.length-1 saatini kontrol ediyoruz.
                if (new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == (new Date().getMinutes() + 59)) {
                    durum = false;

                    let openPrice = parseFloat(json[json.length - 2][1]);
                    let closePrice = parseFloat(json[json.length - 2][4]);
                    let degisim = (closePrice - openPrice) / openPrice * 100;
                    return degisim;

                } else {
                    durum = true;
                }

            })
            .catch(err => {
                if (err == "promiseRequest error #403") {
                    console.log(new Date().toLocaleTimeString() + " - err2: " + coin_name + " - period: " + uzunluk + " - hata: " + err)
                    hata_maili_gonder(err);
                }
            })

        if (durum == true) {
            await bekle(1);
        }
    }

    return parseFloat(degisim).toFixed(2);
}



async function entryPrice_likitPrice_distance(coin_name) {
    let entryPrice = await get_entryPrice(coin_name);

    let likit_price = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return parseFloat(json[i].liquidationPrice);
                }
            }
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", likit price çekerken hata: " + err));

    let distance = (Math.abs(likit_price - entryPrice)) / entryPrice * 100;
    //price.degisim = (price.close-price.open)/price.open*100;

    console.log(new Date().toLocaleTimeString() + " - likitPrice noktasına yaklaştığında ortalama düşürmek için alım yapıldı. " + coin_name + " - entryPrice ile likitPrice arasındaki uzaklık(%): " + distance);
}

async function get_position_leverage(coin_name){ //istenen coin için aktif kaldıraç değerini döndürür.

    let aktif_kaldirac = await binance.futuresPositionRisk()
    .then(json => {
        for (let i = 0; i < json.length; i++) {
            if (json[i].symbol == coin_name) {
                return json[i].leverage;
            }
        }
    })

    return aktif_kaldirac;
}


async function get_bekleyen_list(nereden_cagrildi) {
    let bekleyen_coinler = [];

    try {
        // Binance API çağrısı
        let json = await binance.futuresPositionRisk()
    
        // Gelen veriyi işleme
        if (json && json.length > 0) {
            for (let i = 0; i < json.length; i++) {
                if (json[i].positionAmt != 0) {
                    //console.log(json[i].symbol)
                    bekleyen_coinler.push(json[i].symbol)
                }
            }
        } else {
            console.log("Veri alınamadı veya boş döndü.");
        }
    } catch (error) {
        // Hata durumunda burası çalışır
        console.error("get_bekleyen_list() - Hata oluştu: ", error);
        console.log(new Date().toLocaleTimeString() + " - HATAYA SEBEP OLAN YER => " + nereden_cagrildi)
    }

    return bekleyen_coinler;
}


async function yeni_get_bekleyen_list(coin_name, nereden_cagrildi) {
    let bekleyen_coinler = [];

    await binance.futuresPositionRisk({ symbol: coin_name })
    .then(json => {
        if (json.code == -1003) {
            let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
            console.log(json.msg)
            console.log(new Date().toLocaleTimeString() + " - get_bekleyen_list() futuresPositionRisk request hatası verdi. ban kaldırılma zamanı: " + ban_time);
            console.log(new Date().toLocaleTimeString() + " - HATAYA SEBEP OLAN YER => " + nereden_cagrildi)
            hata_maili_gonder(json.msg);
        }

        for (let i = 0; i < json.length; i++) {
            if (json[i].positionAmt != 0) {
                bekleyen_coinler.push(json[i].symbol)
            }
        }
    })

    return bekleyen_coinler;
}


async function coin_satilmayi_bekliyor(coin_name) { //parametre olaran gelen coin, satılmayı bekliyor mu diye kontrol ediliyor.

    return (await binance.futuresPositionRisk({ symbol: coin_name })
        .then(json => {
            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " -------------- coin_satilmayi_bekliyor() futuresPositionRisk request hatası verdi. ban kaldırılma zamanı: " + ban_time);
                return;
            }

            if (json[0].positionAmt == 0) {
                return true //true: coin satılmayı bekliyor demektir.
            }
            else {
                return false //false: coin satıldı demektir.
            }
        }))
}

async function get_alinan_miktar(coin_name) {
    let alinan_miktar = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return json[i].isolatedWallet;
                }
            }
        })
    return alinan_miktar;
}

async function get_unRealizedProfit(coin_name) {

    let kar_zarar = await binance.futuresPositionRisk()
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                if (json[i].symbol == coin_name) {
                    return json[i].unRealizedProfit;
                }
            }
        })
    return kar_zarar;
}


async function get_lastPrice(coin_name) {
    let durum = true;
    let lastPrice = null;

    while (durum == true) {

        await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice

            //yeni mum aktif ise önceki mumun kapanış fiyatını alıyoruz.
            if(new Date(json[json.length - 1][6]).getHours() == new Date().getHours() && new Date(json[json.length - 1][6]).getMinutes() == (new Date().getMinutes() + 59)){
                durum = false;
                lastPrice = parseFloat(json[json.length - 2][4]);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -7err- " + err));

    }


    return lastPrice;
}
























async function onceki_bollinger(coin_name) {
    let uzunluk = 20, standart_sapma = 2;
    let sum = 0, avg = 0, price = [], diff = [], variance = 0;


    await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice

            for (let i = json.length - 1 - (uzunluk); i < json.length - 1; i++) {
                sum += parseFloat(json[i][4]);
                price.push(parseFloat(json[i][4]));
            }

            avg = sum / uzunluk;

        })
        .catch(err => { console.log(err); hata_maili_gonder(err); });

    for (let i = 0; i < price.length; i++) {
        diff.push(Math.pow((price[i] - avg), 2));
    }

    let toplam = 0;
    for (let i = 0; i < diff.length; i++) {
        toplam += diff[i];
    }
    variance = toplam / uzunluk;

    let sonuc = Math.sqrt(variance);
    let upper = (avg + (standart_sapma * sonuc));
    let lower = (avg - (standart_sapma * sonuc));

    return {
        'mid': parseFloat(avg.toFixed(6)),
        'upper': parseFloat(upper.toFixed(6)),
        'lower': parseFloat(lower.toFixed(6))
    }
}


async function onceki_lastPrice(coin_name) {
    let lastPrice = null;

    await binance.futuresCandles(coin_name, "1h")
        .then(json => {
            //json[json.length-1][1] = openPrice
            //json[json.length-1][2] = maxPrice
            //json[json.length-1][3] = minPrice
            //json[json.length-1][4] = closePrice


            lastPrice = parseFloat(json[json.length - 2][4]);
        })
        .catch(err => console.log(new Date().toLocaleTimeString() + " -8err- " + err));

    return lastPrice;
}

async function bekle(saniye) {
    const waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(saniye * 1000);
}

async function bekle_5dk() {
    let kalan_dk = 4 - (new Date().getMinutes() % 5)
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_15dk() {
    let kalan_dk = 14 - (new Date().getMinutes() % 15)
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_60dk() {
    let kalan_dk = 59 - new Date().getMinutes()
    let kalan_sn = 60 - new Date().getSeconds()
    // console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second + 2000);
}

async function yeniden_baslat_60dk() {
    let kalan_dk = 59 - new Date().getMinutes()
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = (kalan_dk-15) * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second);
}

async function bekle_60sn() {
    let kalan_sn = 60 - new Date().getSeconds()

    let second = kalan_sn * 1000;
    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(second);
}

async function long_kademeli_alim_emri_olustur(coin_name,quantity,buyPrice){ //%10 düştüğünde kademeli alım yapabilmek için limit emri oluşturan fonksiyon.
    let tickSize = await find_tickSize_price(coin_name);
    
    await binance.futuresBuy(coin_name, quantity, parseFloat(buyPrice).toFixed(tickSize))
    .then(json => {

        if (json.status == 'NEW') { //long limit satış emri başarıyla oluşturuldu.
            console.log(new Date().toLocaleTimeString() + ' - Kademeli limit emri oluşturma BAŞARILI: ' + coin_name + " - buyPrice: " + buyPrice + " - quantity: " + quantity);
        }
        else if (json.code < 0) { //long limit satış emri oluşturulamadı.
            console.log(new Date().toLocaleTimeString() + " - Kademeli limit emri oluşturma BAŞARISIZ: " + coin_name + " - buyPrice: " + buyPrice + " - quantity: " + quantity);
            console.log(json)
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + " -10err- " + err));
}

async function long_sell_order(coin_name, entryPrice, quantity){

    let tickSize = await find_tickSize_price(coin_name);
    let takeProfit = (entryPrice * (1 + profit_rate)).toFixed(tickSize)

    //TAKE PROFIT ORDER veriyoruz.
    const order = await binance.futuresSell(coin_name, quantity, takeProfit, { reduceOnly: true })
    
    if (order.status === 'NEW') {
        console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + takeProfit + " fiyatından LONG SELL ORDER (takeProfit) oluşturuldu. long_sell_order() Quantity: " + quantity);
        tp_order_id_list.push({"order_id":order.orderId, "tp_price":takeProfit, "price":entryPrice})
    }
    else if (order.code < 0) {
        //long_sell_order(coin_name, takeProfit, quantity) //%1 tp oluşturma başarısız olursa %2 tp emri koymayı deneyecek.
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", long_sell_order() işlemi yaparken HATA (market fiyatına satılacak quantity kadarı): " + order.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice + " - takeProfit: " + takeProfit);
        await long_marketSell(coin_name, quantity)
    }

}

async function long_marketSell(coin_name, quantity) { //anlık fiyatı çekip market fiyatına satmak için
    // let lastPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -44err- " + err));
    // let quantity = await get_quantity(coin_name);
    // quantity = (quantity / 2).toFixed(global_stepSize)

    await binance.futuresMarketSell(coin_name, quantity, { reduceOnly: true })
        .then((json) => {

            if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", LONG MARKET SELL HATASI:  => " + json.msg);
            }
            else{
                console.log(new Date().toLocaleTimeString() + " - LONG Market SELL... Satılan Quantity: " + quantity);
            }

        })
        .catch(err => console.log(new Date().toLocaleTimeString() + ' - long_marketSell() requestinde hata var: ' + err))
}


async function short_sell_order(coin_name) {
    let quantity = await get_quantity(coin_name);
    let tickSize = await get_tickSize(coin_name);
    let entryPrice = await get_entryPrice(coin_name);
    let takeProfit = entryPrice * (1 - profit_rate); //kar yüzdesi (takeProfit)
    // let stopLoss = entryPrice + (atr*atr_kat)

    //TAKE PROFIT değerini giriyoruz.
    await binance.futuresBuy(coin_name, quantity, takeProfit.toFixed(tickSize), { reduceOnly: true })
    .then((json) => {

        if (json.status == 'NEW') { //futuresBuy işlemi başarılı 
            console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + takeProfit.toFixed(tickSize) + " fiyatından SHORT SELL ORDER(takeProfit) oluşturuldu.");
        }
        else if (json.code < 0) { //futuresBuy işlemi başarısız
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", short_sell_order() işlemi yaparken HATA verdi => " + json.msg + " - quantity: " + quantity + " - entryPrice: " + entryPrice + " - takeProfit: " + takeProfit.toFixed(tickSize));
            console.log(json)
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + " -12err- " + err));



    //STOP LOSS değerini giriyoruz.
    // await binance.futuresMarketBuy( coin_name, quantity, {reduceOnly: true, stopPrice: parseFloat(stopLoss).toFixed(tickSize), type:'STOP_MARKET'} )
    // .then((json) => {
    //     console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', ' + parseFloat(stopLoss).toFixed(tickSize) +  " fiyatından SHORT(stopLoss) verildi.");
    //     // console.log(json)
    // })
    // .catch(err => console.log(new Date().toLocaleTimeString() + ' - stopLoss requestinde hata var: ' + err))






    //TRAILING STOP LOSS değerini giriyoruz. NOT: düzgün çalışmıyor.
    /*await binance.futuresMarketBuy( coin_name, quantity, {reduceOnly: true, callbackRate: 1, type:'TRAILING_STOP_MARKET'} )
    .then((json)=> {
        console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + ', SHORT TRAILING STOP LOSS ORDER verildi.');
    })
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - short stopLoss requestinde hata var: ' + err))*/

}


async function cancelOrder_and_reOpenOrder(coin_name, orderType) {
    //parametre olarak gelen coine ait "stopLoss, takeProfit, Buy, Sell vb." açık olan tüm emirler iptal edilir ve orderType(long veya short) değerine göre satış emri verilir.

    let orderId = [];

    //açık olan emirleri iptal edebilmek için "orderId" bilgisine ihtiyacımız var.
    //açık emirlerin orderId listesi alınıyor.
    await binance.futuresOpenOrders(coin_name)
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                //console.log(i + " - " + coin_name + " - orderID: " + json[i].orderId)
                orderId.push(json[i].orderId);
            }
        })

    //orderId kullanılarak ilgili coine ait tüm açık emirler iptal ediliyor.
    for (let i = 0; i < orderId.length; i++) {
        await cancel_buy_order(coin_name, orderId[i]);
    }


    if (orderType == "long") {
        long_sell_order(coin_name); //long buy yapıldıysa takeProfit için long sell işlemi yapılmalıdır.
    }
    else if (orderType == "short") {
        short_sell_order(coin_name); //short buy yapıldıysa takeProfit için short sell işlemi yapılmalıdır.
    }
    else {
        console.log(new Date().toLocaleTimeString() + ' - Geçersiz orderType girildi. Parametre olarak girilen orderType değerini kontrol et!: orderType: ' + orderType);
    }





}















async function cancel_buy_order(coin_name, coin_orderId) {
    let str_order_id = coin_orderId.toString(); //futuresOrderStatus ve futuresCancel fonksiyonları string veri tipinde order id kabul ediyor.

    await binance.futuresOrderStatus(coin_name, { orderId: str_order_id })
        .then(json => {
            if (json.status == 'NEW') {
                binance.futuresCancel(coin_name, { orderId: str_order_id })
            }
            else if (json.code < 0) { //futuresMarketSell işlemi başarısız
                console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", iptal ederken HATA verdi => " + json.msg);
            }
        }).catch(err => console.log(new Date().toLocaleTimeString() + " -13err- " + err));
}

async function cancel_all_orders(coin_name) {
    let orderId = [];

    //açık olan emirleri iptal edebilmek için "orderId" bilgisine ihtiyacımız var.
    //açık emirlerin orderId listesi alınıyor.
    await binance.futuresOpenOrders(coin_name)
        .then(json => {
            for (let i = 0; i < json.length; i++) {
                //console.log(i + " - " + coin_name + " - orderID: " + json[i].orderId)
                orderId.push(json[i].orderId);
            }
        })

    //orderId kullanılarak ilgili coine ait tüm açık emirler iptal ediliyor.
    for (let i = 0; i < orderId.length; i++) {
        // await cancel_buy_order(coin_name, orderId[i]);
        cancel_buy_order(coin_name, orderId[i]);
    }
}



async function get_entryPrice(coin_name) {
    let entryPrice = null;
    let counter = 0;

    while (counter<10) {
        entryPrice = await binance.futuresPositionRisk({ symbol: coin_name })
            .then(json => parseFloat(json[0].entryPrice));

        if (entryPrice != 0) {
            return entryPrice;
        } else {
            counter++
            await bekle(1);
        }
    }

}



async function get_balance() { //kullanılabilir bakiyeyi return eder.
    let balance = await binance.futuresAccount()
        .then(json => {
            return parseFloat(json.availableBalance)
        })
        .catch(err => { console.log(new Date().toLocaleTimeString() + ' - get_balance() fonksiyonu içinde, bakiye kontrol edilirken hata: ' + err) });
    return parseFloat(balance).toFixed(2);
}

async function get_leverage(coin_name) {
    return await binance.futuresLeverageBracket(coin_name).then(json => {
        return json[0]["brackets"][0].initialLeverage;
        //console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + " - " + max_leverage)
    }).catch((err) => {
        console.log(new Date().toLocaleTimeString() + ' - ' + coin_name + " - hata: " + err);
        //console.log(err)
        //get_leverage(coin_name)
    })
}

async function max_leverage(coin_name) {
    let max_lev = await binance.futuresLeverageBracket(coin_name)
        .then(json =>json[0]["brackets"][0].initialLeverage)
        .catch((err) => console.log("max_leverage() hata: " + coin_name + " - " + err))
    
    return max_lev;
}

async function set_leverage(coin_name, new_leverage) {
    try {

        await binance.futuresLeverage(coin_name, new_leverage)
            .then(json => {
                console.log(new Date().toLocaleTimeString() + " - set_leverage() ataması yaparken JSON; ")
                console.log(json)

                if (json.code == -4028) {
                    return max_leverage(coin_name);
                }
            })
            .then(max_leverage => {
                set_leverage(coin_name, max_leverage);
            })
            .catch(err => console.log(new Date().toLocaleTimeString() + " -40err- " + err));

    } catch (error) {
        console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - set_leverage() içindeki try catch bloğuna takıldı. HATA: " + error);
        await bekle(2);
        set_leverage(coin_name, new_leverage);
    }
}


//bot başladığında kademeli alım sayısına göre aşağıya limit buy emirleri hızlıca async await kullanmadan hızlıca oluşturmak için bu fonksiyonu oluşturdum. 16.11.2024
async function limit_buy_emri_with_profit_rate(coin_name, price, kar_orani){ //parametre ile verilen profit_rate=kar_orani'na göre aşağıya limit buy emri oluşturmak için kullanılacak fonksiyon.
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        let stepSize = await find_stepSize_quantity(coin_name);
        let limit_price = (price*(1-kar_orani)).toFixed(tickSize)

        var y = amount * leverage / limit_price
        var quantity = parseFloat(y.toFixed(stepSize))

        // 1. Limit Alış Emri Oluşturma
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' });

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            // console.log(coin_name + ' - Limit emri oluşturuldu: ' + limit_price);
            buy_order_id_list.push({"order_id":limitOrder.orderId, "buy_price":limit_price, "buy_quantity":quantity})
        }
        else {
            // open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - limit_buy_emri_with_profit_rate() fonksiyonunda hata verdi. limit_price: " + limit_price + " - kar_orani: " + kar_orani)
            console.log(limitOrder)

            await bekle(1) //hata verirse, 1sn bekledikten sonra aynı fiyata emir oluşturmayı tekrar deneyecek.
            limit_buy_emri_with_profit_rate(coin_name, price, kar_orani)
            return
        }

    } catch (error) {
        console.error('Error placing orders:', error.body || error);
    }
}


async function direkt_limit_buy_emri(coin_name, limit_price) {
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        let stepSize = await find_stepSize_quantity(coin_name);
        limit_price = limit_price.toFixed(tickSize)

        var y = amount * leverage / limit_price
        var quantity = parseFloat(y.toFixed(stepSize))

        // 1. Limit Alış Emri Oluşturma
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' });

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            console.log(coin_name + ' - ESKİ LİMİT BUY EMRİ TEKRAR OLUŞTURULDU: ' + limit_price + " - order_status: " + limitOrder.status);
            buy_order_id_list.push({"order_id":limitOrder.orderId, "buy_price":limit_price, "buy_quantity":quantity})
        }
        else {

            // open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - direkt limit emri oluşturulamadı hata var, direkt_limit_buy_emri() fonksiyonunu kontrol et HATA::: ")
            console.log(limitOrder)
            return

        }

        

    } catch (error) {
        console.error('Error placing orders:', error.body || error);
    }
}

async function limit_buy_emri(coin_name, price) {
    try {
        
        let tickSize = await find_tickSize_price(coin_name);
        let stepSize = await find_stepSize_quantity(coin_name);
        let limit_price = (price*(1-profit_rate)).toFixed(tickSize)

        // console.log()
        // console.log(new Date().toLocaleTimeString() + " YENİ LİMİT BUY EMRİ OLUŞTURULACAK. - price: " + price + " - limit_price: " + limit_price)

        var y = amount * leverage / limit_price
        var quantity = parseFloat(y.toFixed(stepSize))

        //aynı limit emri fiyatı array'de varsa tekrar limit emir oluşturulmayacak. fonksiyonu sonlandır.
        for(let i=0;i<buy_order_id_list.length;i++){
            //limit price * 1.002 ile limit price * 0.998 arasında ise çok yakın fiyata daha önce limit emir koyulmuş demektir. Tekrar limit buy emri oluşturulmayacak.
            if(buy_order_id_list[i].buy_price > limit_price*0.998 && buy_order_id_list[i].buy_price < limit_price*1.002){
                // console.log(new Date().toLocaleTimeString() + " - aynı limit emirden daha önce oluşturulduğu için " + limit_price + " fiyatına tekrar limit buy emri oluşturulmayacak. alt_limit: " + limit_price*0.998 + " - ust_limit: " + limit_price*1.002)
                // console.log(buy_order_id_list)
                return;
            }
        }




        // 1. Limit Alış Emri Oluşturma
        const limitOrder = await binance.futuresBuy(coin_name, quantity, limit_price, { type: 'LIMIT' });

        // Emrin gerçekleşip gerçekleşmediğini kontrol et
        if (limitOrder && limitOrder.orderId) {
            console.log(coin_name + ' - Limit emri oluşturuldu: ' + limit_price);
            buy_order_id_list.push({"order_id":limitOrder.orderId, "buy_price":limit_price, "buy_quantity":quantity})
        }
        else {
            open('D:\\horoz_alarm.mp4');
            console.log(new Date().toLocaleTimeString() + " - limit emri oluşturmada hata: ")
            console.log(limitOrder)
            //limit oluştururken hata verirse ne yapılacak ? => biraz daha aşağıdan tekrar oluşturmayı denesin.
            limit_buy_emri(coin_name, limit_price)
            return

        }

        

    } catch (error) {
        console.error('Error placing orders:', error.body || error);
    }
}

async function short_buy_oco_order(coin_name, atr) { //short market buy
    /*
    let max_lev = await max_leverage(coin_name);
    if(max_lev<leverage){
        leverage = max_lev;
    }
    */

    let stepSize = await find_stepSize_quantity(coin_name);
    // let stepSize = await get_stepSize(coin_name);
    let lastPrice = await binance.futuresCandles(coin_name, "1d", { limit: 10 }).then(json => parseFloat(json[json.length - 1][4])).catch(err => console.log(new Date().toLocaleTimeString() + " -44err- " + err));
    
    

    await binance.futuresLeverage(coin_name, leverage).catch(err => console.log(new Date().toLocaleTimeString() + " -42err- " + err)); //kaldıraç
    await binance.futuresMarginType(coin_name, 'ISOLATED').catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));
    // await binance.futuresMarginType(coin_name, 'CROSSED')/*.then(json => console.log(json))*/.catch(err => console.log(new Date().toLocaleTimeString() + " -41err- " + err));


    var y = amount * leverage / lastPrice
    var quantity = parseFloat(y.toFixed(stepSize))

    await binance.futuresMarketSell(coin_name, quantity)
    .then((json) => {

        if (json.status == 'NEW') { //futuresMarketBuy işlemi başarılı 
            console.log(new Date().toLocaleTimeString() + ' - ' + (++buy_count) + ' - ' + coin_name + ', ' + lastPrice + ' fiyatından SHORT Market BUY ORDER verildi.');
            cancelOrder_and_reOpenOrder(coin_name, "short", atr);
        }
        else if (json.code < 0) { //futuresMarketBuy işlemi başarısız
            console.log(new Date().toLocaleTimeString() + " - " + coin_name + ", futuresMarketSell() işlemi yaparken HATA verdi => " + json.msg);
        }

    })
    .catch(err => console.log(new Date().toLocaleTimeString() + ' - short_buy_oco_order() içindeki futuresMarketBuy request hatası: ' + err))

    return {
        'coin_name':coin_name,
        'quantity':quantity,
        'amount':amount.toFixed(2),
    }
}


async function get_quantity(coin_name) {
    await bekle(5);

    let quantity = await binance.futuresAccount()
    .then(json => {
        for (let i = 0; i < json.positions.length; i++) {
            if (json.positions[i].symbol == coin_name) {
                return Math.abs(json.positions[i].positionAmt);
            }
        }
    }).catch(err => console.log("get_quantity() HATA: " + err))

    return quantity;
}

async function get_income() {

    let income = await binance.futuresIncome({ limit: 1000 })
    let today = new Date().toLocaleDateString();
    let kar_zarar = 0, komisyon = 0;

    for (let i = 0; i < income.length; i++) {
        if (new Date(income[i].time).toLocaleDateString() == today) {

            if (income[i].incomeType == "REALIZED_PNL" || income[i].incomeType == "INSURANCE_CLEAR") {
                kar_zarar += parseFloat(income[i].income);
            }
            else if (income[i].incomeType == "COMMISSION") {
                if (income[i].asset == "BNB") {
                    komisyon += await binance.futuresPrices({ symbol: 'BNBUSDT' }).then(json => parseFloat(json.price * income[i].income));
                } else if (income[i].asset == "USDT") {
                    komisyon += parseFloat(income[i].income);
                }
            }

        }
    }

    let bekleyen_miktar = await binance.futuresAccount()
        .then(json => {
            let acik_pozisyon_miktari = parseFloat(json.totalInitialMargin)
            if (acik_pozisyon_miktari > 0) {
                console.log("SATIŞ EMRİ BEKLEYEN COİN VAR ---> BEKLEYEN TOPLAM MİKTAR: " + acik_pozisyon_miktari.toFixed(2) + " $");
            }

            return acik_pozisyon_miktari;
        })

    if (bekleyen_miktar > 0) {
        let bekleyen_coinler = [];

        await binance.futuresPositionRisk()
            .then(json => {
                for (let i = 0; i < json.length; i++) {
                    if (json[i].positionAmt != 0) {
                        bekleyen_coinler.push({ 'coin_adi': json[i].symbol, 'alis_saati': new Date(json[i].updateTime).toLocaleTimeString(), 'alis_fiyati': json[i].entryPrice, 'guncel_fiyat': json[i].markPrice, 'likidite_olma_fiyati': json[i].liquidationPrice, 'kaldirac': json[i].leverage, 'pozisyon': json[i].entryPrice > json[i].liquidationPrice ? 'LONG' : 'SHORT', 'guncel_kar_zarar_durumu': json[i].unRealizedProfit >= 0 ? `${parseFloat(json[i].unRealizedProfit).toFixed(2)} $ kar` : `${parseFloat(json[i].unRealizedProfit).toFixed(2)} $ zarar` })
                    }
                }
            })

        console.log(bekleyen_coinler)
    }

}

async function get_profit() {
    let today = new Date().toLocaleDateString();
    let kar_zarar = 0, komisyon = 0, gunluk_al_sat_sayisi = 0;

    await binance.futuresIncome({ limit: 300 })
        .then(json => {
            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " - get_profit() income request hatası verdi. ban kaldırılma zamanı: " + ban_time);
                hata_maili_gonder(json.msg);
            }
            else {
                for (let i = 0; i < json.length; i++) {
                    if (new Date(json[i].time).toLocaleDateString() == today) {

                        if (json[i].incomeType == "REALIZED_PNL" || json[i].incomeType == "INSURANCE_CLEAR") {
                            kar_zarar += parseFloat(json[i].income);
                            gunluk_al_sat_sayisi++;
                        }
                        else if (json[i].incomeType == "COMMISSION") {
                            if (json[i].asset == "BNB") {
                                //komisyon += await binance.futuresPrices({symbol:'BNBUSDT'}).then(json => parseFloat(json.price*income[i].income));
                                //bnb ile fee ödemesi yaparken atlanacak, await response dışına alınmalı.
                            } else if (json[i].asset == "USDT") {
                                komisyon += parseFloat(json[i].income);
                            }
                        }
                        else if (json[i].incomeType == "FUNDING_FEE"){
                            komisyon += parseFloat(json[i].income);
                        }
                    }
                }
            }
        })

    let net_kar_zarar = kar_zarar + komisyon;

    //return "Günlük AL/SAT Sayısı: " + gunluk_al_sat_sayisi + " - GÜNLÜK NET KAR/ZARAR => " + net_kar_zarar.toFixed(2) + " $";
    return "GÜNLÜK NET KAR/ZARAR => " + net_kar_zarar.toFixed(2) + " $";
}

async function gunluk_al_sat_yapildi() { //gece 12den sonra, gunluk_al_sat_sayisi SIFIRLANIYOR.

    let income = await binance.futuresIncome({ limit: 100 })
    let today = new Date().toLocaleDateString();

    for (let i = 0; i < income.length; i++) {
        if (new Date(income[i].time).toLocaleDateString() == today) {

            if (income[i].incomeType == "REALIZED_PNL" || income[i].incomeType == "INSURANCE_CLEAR") {
                return true;
            }
        }
    }

    return false;
}

async function sort_coins(coin_array) {
    for (let i = 0; i < coin_array.length; i++) {
        for (let j = 0; j < coin_array.length; j++) {
            if (coin_array[i].kazandirma_orani > coin_array[j].kazandirma_orani) {
                let temp_coin_name = coin_array[i].coin_name
                let temp_kazandirma_orani = coin_array[i].kazandirma_orani

                coin_array[i].coin_name = coin_array[j].coin_name
                coin_array[i].kazandirma_orani = coin_array[j].kazandirma_orani

                coin_array[j].coin_name = temp_coin_name
                coin_array[j].kazandirma_orani = temp_kazandirma_orani

            }
        }
    }
}

async function sort_list(coin_array) {
    for (let i = 0; i < coin_array.length; i++) {
        for (let j = 0; j < coin_array.length; j++) {
            if (coin_array[i].atr_degisim > coin_array[j].atr_degisim) {
                let temp_coin_name = coin_array[i].coin_name
                let temp_atr_degisim = coin_array[i].atr_degisim

                coin_array[i].coin_name = coin_array[j].coin_name
                coin_array[i].atr_degisim = coin_array[j].atr_degisim

                coin_array[j].coin_name = temp_coin_name
                coin_array[j].atr_degisim = temp_atr_degisim
            }
        }
    }
}



async function coinler() {

    let coin_list = []

    await binance.futuresExchangeInfo()
    .then(json => {

        for (let i = 0; i < json.symbols.length; i++) {
            if (json.symbols[i].status == 'TRADING' && json.symbols[i].quoteAsset == 'USDT' && json.symbols[i].contractType == 'PERPETUAL') {
                if (ignored_coin_list.indexOf(json.symbols[i].symbol) === -1) { //aranan eleman ignored_coin_list dizisinde yok ise coin_list dizisine eklenecek.
                    coin_list.push(json.symbols[i].symbol);
                }
            }

        }
    })
    .catch(err => { console.log(new Date().toLocaleTimeString() + " - err1: " + err);  })

    return coin_list
}


async function send_mail(kime, konu, mesaj) {
    
    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'mustang15935746@gmail.com',
            pass: 'tjkfpsrwzfgswwss'
        }
    });
    var mailOptions = {
        from: 'mustang15935746@gmail.com',
        to: kime,
        subject: konu,
        text: mesaj
    };
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            //console.log('Email sent: ' + info.response);
            //console.log(new Date().toLocaleTimeString() + " - Cüneyt maili gönderildi.");
        }
    });
}

async function send_mail_cuneyt(konu, mesaj){
    let hata=false
    while (true) {
        var transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'mustang15935746@gmail.com',
                pass: 'tjkfpsrwzfgswwss'
            }
        });
        var mailOptions = {
            from: 'mustang15935746@gmail.com',
            to: 'gfbcnyt@gmail.com',
            subject: konu,
            text: mesaj
        };
        transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                hata=true
                // console.log(error);
            } else {
                hata=false
                //console.log('Email sent: ' + info.response);
                //console.log(new Date().toLocaleTimeString() + " - Cüneyt maili gönderildi.");
            }
        });

        if(hata==true){
            console.log(new Date().toLocaleTimeString() + " - Mail gönderirken hata; " + konu)
            await bekle(60);
        }else{
            return;
        }
    }
}

// API'yi başlatma
app.listen(port, () => {
    console.log(`Sunucu ${port} portunda çalışıyor`);
});