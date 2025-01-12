// Firebase SDK'sını içe aktarma
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Firebase yapılandırması (Firebase Console'dan alın)
const firebaseConfig = {
    apiKey: "AIzaSyAUVBymz6xtI7EgRqO9nbMwHGu4Mmymrns",
    authDomain: "rsidb-4a5f7.firebaseapp.com",
    projectId: "rsidb-4a5f7",
    storageBucket: "rsidb-4a5f7.firebasestorage.app",
    messagingSenderId: "692809262606",
    appId: "1:692809262606:web:acc6b4fcb0f8961e4b3e5f"
};

// Firebase uygulamasını başlat
const app = initializeApp(firebaseConfig);

// Firestore örneğini başlat
const db = getFirestore(app);

export { db };
