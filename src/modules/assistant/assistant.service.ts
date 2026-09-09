import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DASAR_HITUNG, resolvePage } from "./page-context";

/** Satu pesan dalam percakapan. */
export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Model utama dan cadangannya.
 *
 * Dipilih setelah diuji langsung ke key ini: llama-3.3-70b-versatile yang
 * disebut dokumentasi Groq justru menjawab 404 model_not_found, jadi jangan
 * menggantinya tanpa memeriksa GET /openai/v1/models lebih dulu.
 *
 * Qwen dipilih sebagai utama karena dua kali lebih cepat dan bahasa
 * Indonesianya lebih bersih; gpt-oss menyisipkan tanda hubung non-standar
 * yang tampak seperti karakter rusak di layar.
 */
const MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"];
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Asisten yang menjelaskan fitur panel admin.
 *
 * Jalan lewat server, bukan langsung dari browser: kunci Groq tidak boleh
 * sampai ke klien karena siapa pun bisa membacanya lewat DevTools lalu
 * memakai kuota kami.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(private readonly config: ConfigService) {}

  private get key(): string {
    const k = this.config.get<string>("GROQ_API_KEY", "");
    if (!k) {
      throw new ServiceUnavailableException(
        "Asisten belum dikonfigurasi (GROQ_API_KEY belum diisi).",
      );
    }
    return k;
  }

  /** Konteks halaman + pertanyaan saran, dipakai frontend saat membuka chat. */
  pageContext(path: string) {
    const { path: matched, info } = resolvePage(path);
    return {
      path: matched,
      title: info.title,
      summary: info.summary,
      suggestions: info.suggestions,
    };
  }

  /**
   * Prompt sistem dibentuk di server dari konteks halaman.
   *
   * Klien hanya mengirim path, tidak boleh mengirim teks konteksnya sendiri:
   * kalau boleh, siapa pun bisa menyuruh asisten mengarang aturan hadiah yang
   * tidak benar lalu menunjukkannya sebagai jawaban resmi.
   */
  private systemPrompt(path: string): string {
    const { info } = resolvePage(path);
    return [
      "Kamu asisten panel admin YCS 2026 (Youth Character Summit), sebuah ajang voting dan seleksi pelajar SMA/SMK di Universitas STEKOM.",
      "Tugasmu menjelaskan fitur panel admin ke panitia.",
      "",
      `Panitia sedang membuka halaman: ${info.title}`,
      `Gunanya: ${info.summary}`,
      "",
      "Yang perlu kamu ketahui tentang halaman ini:",
      ...info.features.map((f) => `- ${f}`),
      "",
      // Disertakan di setiap halaman: pertanyaan "angka ini dari mana" muncul
      // di mana saja, dan tanpa rumusnya model akan mengarang cara hitung
      // yang terdengar masuk akal tapi salah.
      "Cara perhitungan yang berlaku di seluruh sistem:",
      ...DASAR_HITUNG.map((d) => `- ${d}`),
      "",
      "Aturan menjawab:",
      "- Jawab dalam bahasa Indonesia yang wajar, seperti menjelaskan ke rekan kerja.",
      "- Ringkas. Dua sampai empat kalimat cukup untuk pertanyaan biasa.",
      "- Kalau jawabannya ada di daftar di atas, pakai itu dan jangan menambah-nambahi.",
      "",
      "PENTING soal cara membuka jawaban:",
      "- KALIMAT PERTAMA wajib berisi jawaban atau langkah konkret. Jangan pernah dipakai untuk menyatakan keterbatasan, dalam bentuk apa pun. Melarang frasa saja tidak cukup: 'Jumlah pemenang tidak bisa saya sebutkan karena...' sama buruknya dengan 'Saya tidak tahu', karena sama sama membuka dengan hal yang tidak bisa kamu lakukan.",
      "- Kalau perlu menyebut keterbatasan, taruh di kalimat TERAKHIR dan singkat saja. Sering kali malah tidak perlu disebut sama sekali.",
      "- LANGSUNG jawab dengan penjelasannya. Kalau panitia menyebut sebuah angka, jelaskan angka semacam itu terbentuk dari apa, memakai daftar cara perhitungan di atas. Perlakukan pertanyaan 'angka X dari mana' sebagai 'bagaimana angka itu dihitung', karena memang itu yang dia ingin tahu.",
      "- Kamu memang tidak melihat isi datanya, tapi itu TIDAK perlu diumumkan di awal. Cukup jelaskan cara terbentuknya angka itu tanpa mengulang-ulang nilai yang dia sebut sebagai fakta yang kamu ketahui.",
      "- Kalau penjelasanmu mungkin belum menjawab yang dia maksud, tutup dengan satu kalimat saran: rincian per orang bisa dilihat di halaman terkait, atau tanyakan ke admin sistem kalau butuh angka pastinya. Taruh di AKHIR, bukan di awal.",
      "- Kalau dia menanyakan ISI DATA, baik jumlah maupun daftar (berapa totalnya, siapa saja, yang mana, nama-namanya), buka LANGSUNG dengan tempatnya di layar. Contoh bentuk yang benar: 'Jumlah pemenang ada di bagian Riwayat Pemenang halaman ini. Angkanya dihitung dari kupon yang sudah ditandai menang, sedangkan yang dibatalkan tidak ikut.' Perhatikan kalimat pertamanya menunjukkan tempat, bukan menyatakan kamu tidak bisa melihatnya.",
      "- Setelah menunjukkan tempatnya, jelaskan arti kolom atau statusnya supaya panitia tahu angka yang dia lihat itu menghitung apa. Jangan menebak isi datanya.",
      "- Jangan membuat contoh berangka. Menulis 'misalnya kuota dasar 100 ditambah 108' membuat panitia mengira itu angka sistem yang sebenarnya. Jelaskan rumusnya dengan kata-kata saja.",
      "",
      "Aturan lain:",
      "- Kalau ditanya asal sebuah angka, jelaskan rumusnya lalu sebutkan apa saja yang TIDAK ikut dihitung. Bagian yang tidak dihitung inilah yang biasanya membuat panitia bingung.",
      "- Jangan menyebut nama tabel, nama kolom, atau potongan SQL. Panitia bukan pengembang, jadi jelaskan dengan istilah yang mereka lihat di layar.",
      "- Jangan menyebutkan jumlah peserta, poin, atau vote sebagai fakta yang kamu tahu, karena kamu tidak membaca datanya. Menjelaskan CARA menghitungnya selalu boleh dan itulah tugasmu.",
      "- Jangan mengarang cara kerja teknis yang tidak disebutkan di atas. Kalau sebuah fitur benar-benar di luar yang kamu ketahui, jelaskan bagian yang kamu tahu lebih dulu, baru sarankan menanyakan ke admin sistem untuk sisanya.",
      "- Larangan mengarang ini LEBIH KUAT daripada dorongan untuk selalu menjelaskan. Kalau sebuah rumus atau penyebab tidak tercantum di atas, JANGAN menyusun sendiri istilah yang terdengar masuk akal, mis. status atau syarat yang tidak pernah disebutkan. Lebih baik menjelaskan hal terdekat yang memang kamu ketahui, lalu bilang bahwa perinciannya perlu dikonfirmasi ke admin sistem.",
      "- Jangan memakai kata seperti 'kemungkinan besar' atau 'biasanya' untuk menutupi ketidaktahuan soal cara kerja. Kalau rumusnya ada di daftar, sebut dengan yakin. Kalau tidak ada, akui bagian itu belum kamu ketahui, tanpa menjadikannya pembuka jawaban.",
      "- Kalau pertanyaannya soal halaman lain, jawab sebisanya lalu sebutkan halaman mana yang tepat untuk itu.",
      "- Jangan pakai tanda pisah em dash.",
      "- Boleh pakai daftar bernomor kalau menjelaskan langkah.",
    ].join("\n");
  }

  /** Kirim pertanyaan ke Groq, kembalikan jawabannya. */
  async ask(opts: { path: string; message: string; history?: ChatTurn[] }) {
    const message = opts.message?.trim();
    if (!message) throw new BadRequestException("Pertanyaan masih kosong.");

    // Riwayat dipangkas: percakapan panjang menghabiskan kuota token tanpa
    // menambah kualitas jawaban untuk pertanyaan seputar satu halaman.
    const history = (opts.history ?? []).slice(-6).map((t) => ({
      role: t.role,
      content: String(t.content).slice(0, 2000),
    }));

    const payload = {
      messages: [
        { role: "system", content: this.systemPrompt(opts.path) },
        ...history,
        { role: "user", content: message.slice(0, 2000) },
      ],
      temperature: 0.3,
      max_tokens: 700,
    };

    let res: Response | null = null;
    for (const [i, model] of MODELS.entries()) {
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, ...payload }),
        });
      } catch (e) {
        const sebab = e instanceof Error ? e.message : String(e);
        this.logger.error(`Groq tak terjangkau: ${sebab}`);
        throw new ServiceUnavailableException(
          "Asisten tidak bisa dihubungi. Coba lagi sebentar.",
        );
      }
      // Model dicabut atau tak lagi diizinkan untuk key ini: coba cadangannya
      // supaya asisten tidak mati total hanya karena Groq mengganti katalog.
      const modelHilang = res.status === 404 || res.status === 400;
      if (!modelHilang || i === MODELS.length - 1) break;
      this.logger.warn(
        `Model ${model} tidak terpakai (${res.status}), coba ${MODELS[i + 1]}.`,
      );
    }
    if (!res) {
      throw new ServiceUnavailableException("Asisten tidak bisa dihubungi.");
    }

    // 429 dibedakan dari galat lain supaya frontend bisa menampilkan hitungan
    // mundur, bukan pesan galat umum yang membuat panitia mengira rusak.
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "60");
      throw new HttpException(
        {
          error: "rate_limited",
          retry_after: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60,
          message:
            "Kuota tanya asisten sudah penuh. Tunggu sebentar lalu coba lagi.",
        },
        429,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.error(`Groq galat (${res.status}): ${detail.slice(0, 300)}`);
      throw new InternalServerErrorException(
        `Asisten gagal menjawab (${res.status}).`,
      );
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const answer = body.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new InternalServerErrorException("Asisten menjawab kosong.");
    }

    return {
      answer,
      // Sisa kuota menit ini, untuk peringatan dini di frontend sebelum
      // panitia benar-benar kena 429.
      remaining_tokens: Number(
        res.headers.get("x-ratelimit-remaining-tokens") ?? "",
      ),
      remaining_requests: Number(
        res.headers.get("x-ratelimit-remaining-requests") ?? "",
      ),
    };
  }
}
