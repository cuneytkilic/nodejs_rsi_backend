// ignore_for_file: avoid_print

import 'package:flutter/material.dart';
import 'package:intl/intl.dart'; // Tarih formatlama için gerekli kütüphane
import 'dart:convert'; // JSON işlemek için
import 'package:http/http.dart' as http; // HTTP paketini ekliyoruz
import 'dart:async'; // Timer kullanabilmek için gerekli kütüphane

void main() {
  runApp(const MyApp());
}

int _recordCount = 0; // Global değişken tanımı

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RSI Analiz',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
            seedColor: const Color.fromARGB(255, 40, 124, 110)),
        useMaterial3: true,
      ),
      home: const MyHomePage(title: 'RSI DATA'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  late Future<List<dynamic>> _rsiData;
  late Timer _timer; // Timer değişkeni
  List<dynamic>? _tableData; // Tabloya aktarılacak veriyi tutan değişken

  @override
  void initState() {
    super.initState();
    _rsiData = fetchRsiData(); // Başlangıçta veriyi çekiyoruz

    // Veriyi tabloya yüklemek için _rsiData tamamlandığında işlemi bekliyoruz
    _rsiData.then((data) {
      setState(() {
        _tableData = data; // Tablo verisini güncelliyoruz

        // RSI sütununa göre sıralama
        _tableData?.sort((a, b) => a['rsi'].compareTo(b['rsi']));

        // Global değişkene kayıt sayısını kaydet
        _recordCount = data.length;
      });
    });

    _startHourlyUpdate(); // Saatlik güncellemeyi başlatıyoruz
  }

  @override
  void dispose() {
    _timer.cancel(); // Timer'ı temizliyoruz
    super.dispose();
  }

  // API'den RSI verisini çeken fonksiyon
  Future<List<dynamic>> fetchRsiData() async {
    final Uri url = Uri.parse('https://rsi-sven.onrender.com/get-rsi-data');
    final response = await http.get(
      url,
      headers: {
        'Bypass-Tunnel-Reminder':
            'true', // Şifre ekranını atlamak için bu başlık gerekli
      },
    );

    if (response.statusCode == 200) {
      // Eğer başarılı bir yanıt aldıysak, veriyi JSON formatında çözümleriz
      return json.decode(response.body);
    } else {
      // Eğer bir hata alırsak, boş bir liste döndürürüz
      throw Exception('Failed to load RSI data');
    }
  }

  // Saatlik veri güncellemesini başlatan fonksiyon
  void _startHourlyUpdate() {
    final now = DateTime.now();
    final nextHour = DateTime(now.year, now.month, now.day, now.hour + 1, 0, 0);
    final duration = nextHour.difference(now);

    // İlk saat başına kadar bekleme
    Timer(duration, () async {
      while (true) {
        try {
          // API'den veri çekiyoruz
          List<dynamic> rsiData = await fetchRsiData();

          if (rsiData.isNotEmpty) {
            // Verinin zamanını kontrol edip dönüştürüyoruz
            final insertDateTimeRaw = rsiData[0]['insert_date_time'];

            DateTime insertDateTime;
            if (insertDateTimeRaw is Map &&
                insertDateTimeRaw.containsKey('seconds')) {
              // Eğer veri bir zaman damgası formatında ise (Firebase tarzı)
              insertDateTime = DateTime.fromMillisecondsSinceEpoch(
                insertDateTimeRaw['seconds'] * 1000,
              );
            } else if (insertDateTimeRaw is String) {
              // Eğer veri bir ISO 8601 tarih dizesi ise
              insertDateTime = DateTime.parse(insertDateTimeRaw);
            } else {
              throw Exception("Unsupported date format: $insertDateTimeRaw");
            }

            DateTime currentDateTime = DateTime.now();

            if (insertDateTime.hour == currentDateTime.hour &&
                rsiData.length >= _recordCount) {
              // Eğer veriler saat açısından uyumluysa UI'ı güncelliyoruz
              setState(() {
                _rsiData =
                    Future.value(rsiData); // Yeni veriyi ekrana yansıtıyoruz
                _tableData = rsiData; // Tablo verisini güncelliyoruz
                _tableData?.sort((a, b) => a['rsi'].compareTo(b['rsi']));
              });

              _startHourlyUpdate();
              break;
            }
          }
        } catch (e) {
          print('Hata: $e'); // Hata durumunda log kaydı
        }

        // Her döngü arasında belirli bir süre bekliyoruz
        await Future.delayed(const Duration(seconds: 5));
      }
    });
  }

  // RSI ortalamasını hesaplayan fonksiyon
  double calculateAverageRsi(List<dynamic> data) {
    if (data.isEmpty) return 0.0;

    double total = data.fold(0.0, (sum, item) => sum + item['rsi']);
    return total / data.length;
  }

  // Belirli bir coin_name'e ait RSI değerini bulan fonksiyon
  Map<String, dynamic>? findCoinByName(List<dynamic> data, String coinName) {
    return data.firstWhere((item) => item['coin_name'] == coinName,
        orElse: () => null);
  }

  // Tarih formatlama fonksiyonu
  String _formatFirestoreTimestamp(Map<String, dynamic> timestamp) {
    try {
      final DateTime dateTime =
          DateTime.fromMillisecondsSinceEpoch(timestamp['seconds'] * 1000);
      final DateFormat formatter = DateFormat('dd.MM.yyyy HH:mm');
      return formatter.format(dateTime);
    } catch (e) {
      return 'Geçersiz tarih'; // Formatlama hatası durumunda
    }
  }

  Color _getBackgroundColor(double rsi) {
    if (rsi < 30) {
      return Colors.green;
    } else if (rsi > 70) {
      return Colors.red;
    } else {
      return Colors.transparent;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        title: FutureBuilder<List<dynamic>>(
          future: _rsiData,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return Row(
                children: const [
                  Icon(Icons.hourglass_empty), // Bir ikon ekleyebilirsiniz
                  SizedBox(width: 8), // Boşluk
                  Text('Yükleniyor...'),
                ],
              );
            } else if (snapshot.hasError) {
              return Row(
                children: [
                  Icon(Icons.error, color: Colors.red), // Hata ikonu
                  SizedBox(width: 8),
                  Text('Hata: ${snapshot.error}'),
                ],
              );
            } else if (!snapshot.hasData || snapshot.data!.isEmpty) {
              return Row(
                children: const [
                  Icon(Icons.info, color: Colors.blue), // Bilgi ikonu
                  SizedBox(width: 8),
                  Text('Veri yok'),
                ],
              );
            } else {
              return Row(
                children: [
                  Image.asset(
                    'assets/images/logo.png', // Buraya logonuzun yolunu yazın
                    height: 50, // İstediğiniz boyutu ayarlayın
                  ),
                  SizedBox(width: 8), // Logodan sonra boşluk
                  Text(
                    'Veri Tarihi: ${_formatFirestoreTimestamp(snapshot.data![0]['insert_date_time'])}\n'
                    'Coin sayısı: ${snapshot.data!.length}',
                    style: TextStyle(
                      fontSize: 16, // Yazı boyutu 10 olarak ayarlanır
                    ),
                  ),
                ],
              );
            }
          },
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Card(
                    margin: const EdgeInsets.only(right: 10),
                    child: Container(
                      color: _tableData != null && _tableData!.isNotEmpty
                          ? _getBackgroundColor(
                              calculateAverageRsi(_tableData!))
                          : Colors.transparent,
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: FutureBuilder<List<dynamic>>(
                          future: _rsiData,
                          builder: (context, snapshot) {
                            if (snapshot.connectionState ==
                                ConnectionState.waiting) {
                              return const Center(
                                  child: CircularProgressIndicator());
                            } else if (snapshot.hasError) {
                              return Text('Error: ${snapshot.error}');
                            } else if (!snapshot.hasData ||
                                snapshot.data!.isEmpty) {
                              return const Text('No data available');
                            } else {
                              final data = snapshot.data!;
                              final averageRsi = calculateAverageRsi(data);
                              return Text(
                                'Ortalama RSI: ${averageRsi.toStringAsFixed(2)}',
                                style: const TextStyle(
                                    fontSize: 20, fontWeight: FontWeight.bold),
                                textAlign: TextAlign.left,
                              );
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: Card(
                    margin: const EdgeInsets.only(left: 10),
                    child: Container(
                      color: _tableData != null && _tableData!.isNotEmpty
                          ? _getBackgroundColor(
                              findCoinByName(_tableData!, 'BTCUSDT')?['rsi'] ??
                                  0)
                          : Colors.transparent,
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: FutureBuilder<List<dynamic>>(
                          future: _rsiData,
                          builder: (context, snapshot) {
                            if (snapshot.connectionState ==
                                ConnectionState.waiting) {
                              return const Center(
                                  child: CircularProgressIndicator());
                            } else if (snapshot.hasError) {
                              return Text('Error: ${snapshot.error}');
                            } else if (!snapshot.hasData ||
                                snapshot.data!.isEmpty) {
                              return const Text('No data available');
                            } else {
                              final data = snapshot.data!;
                              final btcusdt = findCoinByName(data, 'BTCUSDT');
                              return Text(
                                btcusdt != null
                                    ? 'Bitcoin RSI: ${btcusdt['rsi']}'
                                    : 'Bitcoin verisi bulunamadı',
                                style: const TextStyle(
                                    fontSize: 20, fontWeight: FontWeight.bold),
                                textAlign: TextAlign.left,
                              );
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            if (_tableData != null && _tableData!.isNotEmpty)
              Expanded(
                child: Container(
                  margin: const EdgeInsets.symmetric(
                    vertical: 10,
                  ), // Yukarı ve aşağı margin
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: const Color.fromARGB(30, 128, 128, 128),
                      width: 1.5,
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  padding: const EdgeInsets.all(10), // İçerik kenar boşluğu
                  child: Column(
                    children: [
                      // Sabit sütun başlıkları
                      Container(
                        color: const Color.fromARGB(
                            255, 238, 238, 238), // Başlık arka plan rengi
                        child: Row(
                          children: const [
                            Expanded(
                              flex: 3,
                              child: Padding(
                                padding: EdgeInsets.all(8.0),
                                child: Text(
                                  'Coin Name',
                                  style: TextStyle(fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                            Expanded(
                              flex: 2,
                              child: Padding(
                                padding: EdgeInsets.all(8.0),
                                child: Text(
                                  'RSI',
                                  style: TextStyle(fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Kaydırılabilir içerik
                      Expanded(
                        child: SingleChildScrollView(
                          scrollDirection: Axis.vertical,
                          child: Column(
                            children: _tableData!.map((item) {
                              return Container(
                                decoration: const BoxDecoration(
                                  border: Border(
                                    bottom: BorderSide(
                                      color: Color.fromARGB(
                                          50, 0, 0, 0), // Alt çizgi rengi
                                      width: 0.5, // Alt çizgi kalınlığı
                                    ),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      flex: 3,
                                      child: Padding(
                                        padding: const EdgeInsets.all(8.0),
                                        child: Text(
                                            item['coin_name'] ?? 'Unknown'),
                                      ),
                                    ),
                                    Expanded(
                                      flex: 2,
                                      child: Padding(
                                        padding: const EdgeInsets.all(8.0),
                                        child: Text(
                                            item['rsi'].toStringAsFixed(2)),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Align(
                alignment: Alignment.bottomCenter,
                child: Text(
                  "Binance Futures, saatlik RSI verileri analiz edilmektedir.",
                  style: const TextStyle(fontSize: 10, color: Colors.grey),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
