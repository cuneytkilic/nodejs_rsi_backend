var express = require('express');
var app = express();
var sql = require("mssql");
var bodyparser = require('body-parser');
const fetch = require("node-fetch");
const open = require('open');
const axios = require('axios');
const notifier = require('node-notifier');
const path = require('path');
const port = 3000;
const cors = require('cors');  // CORS paketini dahil et

// CORS'u etkinleştir
// app.use(cors());
app.use(cors({
    origin: '*', // Tüm kaynaklara izin verir.
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

let tickSize_stepSize_list = []
let ignored_coin_list = []


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


//parametre olarak gelen json dizisini, coin_rsi tablosuna insert eder.
async function insert_rsi_data(json) {
    try {
        const pool = await sql.connect(config);
        let now = new Date();
        const insert_date_time = new Date(now.setHours(now.getHours() + 3)); // Saat eklenip yeni bir Date nesnesi oluşturulur. Şu anki saate 3 saat ekler ( UTC-3 ten dolayı )

        for(let i=0;i<json.length;i++){

            // Insert işlemi
            const query = `
                INSERT INTO coin_rsi (coin_name, rsi, insert_date_time)
                VALUES (@coin_name, @rsi, @insert_date_time)
            `;

            // Parametreler
            await pool.request()
                .input('coin_name', sql.NVarChar, json[i].coin_name)          // coin_name, NVARCHAR
                .input('rsi', sql.Float, json[i].rsi)                           // rsi, FLOAT
                .input('insert_date_time', sql.DateTime, insert_date_time)  // insert_date_time, DATETIME
                .query(query);

        }
        
        

        // console.log('Yeni veri başarıyla eklendi');
        
        // Veritabanı bağlantısını kapatma
        await sql.close();
    } 
    catch (err) {
        console.error('Veritabanı hatası:', err);
    }
}
// Veritabanından RSI verilerini alıp, JSON olarak döndüren endpoint
app.get('/get-rsi-data', async (req, res) => {
    try {
        const pool = await sql.connect(config);
        const result = await pool.request().query('SELECT * FROM coin_rsi WHERE insert_date_time = (SELECT MAX(insert_date_time) FROM coin_rsi)');

        // Veritabanından gelen tüm kayıtları JSON formatında döndür
        const data = result.recordset;

        // Veriyi JSON olarak dön
        res.json(data);

        await sql.close();
    } catch (err) {
        console.error('Veritabanı hatası:', err);
        res.status(500).send('Veritabanı hatası');
    }
});










const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: 'BXL5lvixqVEZY5EsTjO54xqjan42kJPUd6547oKmtPoc9YD3AoHvuWQ4K50cinux', //cüneyt
    APISECRET: 'pmYUkQLgyKj959aoxvjtKojqT2xzO4pWfHpTeGDsTwXk4QyEz39CQasv3eK1ju6P', //cüneyt
    // APIKEY: 'KoankrgkpVEp6u6dljT7AebXNo5nhbW07ovdDCWpxXDfrLp1mrIbNLtnpeGTJRID', //ergün
    // APISECRET: 'RgEd5U38P6Ykoah66uCljBKRLiGDDOIGFqsNdEdABHaGVVF5ORsgKZysPgqAGydc', //ergün
    
    'recvWindow': 10000000,
    baseUrl: "http://https://rsi-vwtw.onrender.com"
});

app.use(bodyparser.json({ type: 'application/json' }));
app.use(bodyparser.urlencoded({ extended: true }));

let buy_count = 0;
let coin_list = [];
let coin_arr = [];
let taranan_coin_sayisi = 0
let json = []

start_bot();
async function start_bot(){
    
    let coin_list = await coinler();
    console.log(new Date().toLocaleTimeString() + " - başladı. coin sayısı: " + coin_list.length)

    while (true) {
        await bekle_60dk();
        json = []
        taranan_coin_sayisi = 0

        for(let i=0;i<coin_list.length;i++){
            coin_tarama(coin_list[i])
            await bekle(0.1)
        }

        while (taranan_coin_sayisi<coin_list.length) {
            await bekle(0.1)
        }
        
        console.log(new Date().toLocaleTimeString() + " - saatlik tarama bitti.")
        await insert_rsi_data(json);
    }

}





async function coin_tarama(coin_name) {
    let data = await saat_calculate_indicators(coin_name);

    if (data === null || typeof data === 'undefined') {
        taranan_coin_sayisi++
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + taranan_coin_sayisi)
        return
    }
    else{
        
        let rsi = parseFloat(data[data.length-2]['rsi'])
        // let atr_degisim = parseFloat(data[data.length-2]['atr_degisim'])
        // let rsi_2 = parseFloat(data[data.length-3]['rsi'])
        // let closePrice = parseFloat(data[data.length-2]['close'])

        json.push({
            "coin_name": coin_name,
            "rsi": parseFloat(rsi.toFixed(2)),
        });
        
        

        
        taranan_coin_sayisi++
        // console.log(new Date().toLocaleTimeString() + " - " + coin_name + " - " + taranan_coin_sayisi)

    }

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

async function bekle_60dk() {
    let kalan_dk = 59 - new Date().getMinutes()
    let kalan_sn = 60 - new Date().getSeconds()
    //console.log(new Date().toLocaleTimeString() + " - Program, " + kalan_dk + "dk - "+kalan_sn+"sn sonra başlayacak.")

    let minute = kalan_dk * 1000 * 60;
    let second = kalan_sn * 1000;

    let waitFor = delay => new Promise(resolve => setTimeout(resolve, delay));
    await waitFor(minute + second + 2000);
}

async function coinler() {

    let coin_list = []

    await binance.futuresExchangeInfo()
        .then(json => {

            if (json.code == -1003) {
                let ban_time = new Date(parseInt(json.msg.split(". ")[0].split(" ")[7])).toLocaleTimeString();
                console.log(json.msg)
                console.log(new Date().toLocaleTimeString() + " - coinler() ban kaldırılma zamanı: " + ban_time);
                hata_maili_gonder(json.msg);
            }

            for (let i = 0; i < json.symbols.length; i++) {
                if (json.symbols[i].status == 'TRADING' && json.symbols[i].quoteAsset == 'USDT' && json.symbols[i].contractType == 'PERPETUAL') {
                    if (ignored_coin_list.indexOf(json.symbols[i].symbol) === -1) { //aranan eleman ignored_coin_list dizisinde yok ise coin_list dizisine eklenecek.
                        coin_list.push(json.symbols[i].symbol);
                        console.log(json.symbols[i].symbol)
                    }
                }

            }
        })
        .catch(err => { console.log(new Date().toLocaleTimeString() + " - err1: " + err); hata_maili_gonder(err); })

    return coin_list
}


// API'yi başlatma
app.listen(port, () => {
    console.log(`Sunucu ${port} portunda çalışıyor`);
});