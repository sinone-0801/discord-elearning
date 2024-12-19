const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const schedule = require('node-schedule');
process.chdir(__dirname);
require('dotenv').config();

const rootDir = path.resolve(__dirname);
const app = express();
const port = 3000;

app.use(express.json());

app.use((req, res, next) => {
  console.log(`Request received: ${req.method} ${req.url}`);
  next();
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.use((req, res, next) => {
  const originalUrl = req.url;
  
  // URLの先頭の//を/elearning/に置換
  req.url = req.url.replace(/^\/\//, '/elearning/');
  
  // /elearning/elearning/のような重複を防ぐ
  req.url = req.url.replace(/^\/elearning\/+/, '/elearning/');
  
  console.log('Original URL:', originalUrl);
  console.log('Normalized URL:', req.url);
  next();
});

// ベースパスの設定
app.use('/elearning', express.static(path.join(rootDir, 'public')));

// Discord Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName('elearning')
    .setDescription('Get the e-learning page URL')
    .toJSON(),
];

// REST APIクライアントの準備
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

// スラッシュコマンドの登録
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(DISCORD_CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error refreshing application (/) commands:', error);
  }
})();

// インタラクションの処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, channelId, guildId } = interaction;

  if (commandName === 'elearning') {
    const userId = interaction.user.id;
    const elearningUrl = `https://sinoland.jp/elearning/index.html?id=${userId}&channelId=${channelId}&guildId=${guildId}`;
    await interaction.reply({
      content: `Here's your e-learning page URL: ${elearningUrl}`,
      ephemeral: true
    });
  }
});

client.login(DISCORD_BOT_TOKEN);

const CSV_FILE = path.join(__dirname, 'data', 'users.csv');

// ユーザーデータ読み込み・書き込み関数
function readCsv() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

function writeCsv(data) {
  // すべての可能なヘッダーを収集
  const allHeaders = new Set(['user_id', 'name']);
  data.forEach(user => {
    Object.keys(user).forEach(key => {
      if (key.startsWith('learning') || key.startsWith('test')) {
        allHeaders.add(key);
      }
    });
  });

  // ヘッダーをソートして配列に変換
  const sortedHeaders = Array.from(allHeaders).sort((a, b) => {
    if (a === 'user_id' || a === 'name') return -1;
    if (b === 'user_id' || b === 'name') return 1;
    return a.localeCompare(b);
  });

  const csvWriter = createCsvWriter({
    path: CSV_FILE,
    header: sortedHeaders.map(header => ({ id: header, title: header }))
  });

  // データにない列に対してデフォルト値を設定
  const completeData = data.map(user => {
    const completeUser = { ...user };
    sortedHeaders.forEach(header => {
      if (!(header in completeUser)) {
        completeUser[header] = '0'; // デフォルト値を '0' に設定
      }
    });
    return completeUser;
  });

  return csvWriter.writeRecords(completeData);
}

// 学習資料のタイトルを取得する関数
function getHtmlTitle(filePath) {
  return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) return reject(err);
          const match = data.match(/<title>([^<]*)<\/title>/); // <title>タグを検索
          if (match) {
              resolve(match[1]); // タイトルを返す
          } else {
              resolve('No Title'); // タイトルがない場合
          }
      });
  });
}

// learning
app.get('/elearning/learning/:file', (req, res) => {
  const filePath = path.join(rootDir, 'public', 'learning', req.params.file);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('Error sending file:', err);
      res.status(404).send("Sorry, that page doesn't exist.");
    }
  });
});

// 学習資料のHTMLファイルとタイトルを取得するエンドポイント
app.get('/elearning/api/learning-materials', async (req, res) => {
  try {
    const learningDir = path.join(__dirname, 'public', 'learning');
    const files = await fs.promises.readdir(learningDir);
    const materials = await Promise.all(files.map(async file => {
      const filePath = path.join(learningDir, file);
      const stats = await fs.promises.stat(filePath);
      if (stats.isFile() && path.extname(file) === '.html') {
        // ファイルの先頭から<title>タグの内容を抽出する簡易的な方法
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const titleMatch = content.match(/<title>(.*?)<\/title>/);
        const title = titleMatch ? titleMatch[1] : file;
        return { file, title };
      }
      return null;
    }));
    res.json(materials.filter(item => item !== null));
  } catch (error) {
    console.error('Error reading learning materials:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// テストデータのJSONファイルリストを取得
app.get('/elearning/api/tests', (req, res) => {
  const dataDir = path.join(__dirname, 'data');
  fs.readdir(dataDir, (err, files) => {
      if (err) {
          console.error('Error reading data directory:', err);
          return res.status(500).json({ error: 'Error reading data directory' });
      }

      const testFiles = files.filter(file => /\.json$/.test(file)); // .jsonファイルのみフィルタリング
      console.log('Test Files:', testFiles); // テストファイルをログ出力
      res.json(testFiles);
  });
});

// ユーザーデータAPI (クエリパラメータからparamsへ)
app.get('/elearning/api/user', async (req, res) => {
  const discordId = req.query.id;
  if (!discordId) {
    return res.status(400).json({ error: 'Discord ID is required' });
  }

  try {
    const users = await readCsvRows();
    let user = users.find(u => u.user_id === discordId);

    if (!user) {
      // ユーザーが見つからない場合、新しいユーザーを作成
      const name = `User_${discordId.substr(0, 5)}`; // 仮の名前を生成
      await addNewUserToCsv(discordId, name);
      user = { user_id: discordId, name: name };
    }

    // ユーザーデータを返す（以前と同じ）
    const userData = {
      user_id: user.user_id,
      name: user.name
    };
    Object.keys(user).forEach(key => {
      if (key.startsWith('learning') || key.startsWith('test')) {
        userData[key] = user[key];
      }
    });
    res.json(userData);
  } catch (error) {
    console.error('Error fetching/creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/elearning/api/user/:userId/update', async (req, res) => {
  console.log('Received update request:', req.params, req.body);
  try {
    const users = await readCsv();
    const userIndex = users.findIndex(u => u.user_id === req.params.userId);

    if (userIndex !== -1) {
      // 既存のユーザーデータを保持しつつ、新しいデータで更新
      users[userIndex] = { ...users[userIndex], ...req.body };
      
      Object.keys(req.body).forEach(key => {
        if (key.startsWith('learning') || key.startsWith('test')) {
          console.log(`User ${req.params.userId} ${key} updated: ${req.body[key]}`);
        }
      });

      await writeCsv(users);
      res.json(users[userIndex]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// クイズデータ取得API
app.get('/elearning/api/quiz/:quizNumber', async (req, res) => {
  const quizNumber = req.params.quizNumber;
  try {
    const quizData = await readQuizData(quizNumber);
    if (quizData && quizData.title && quizData.quiz) {
      // クライアントに送る前に正解を削除し、タイトルを含める
      const clientQuiz = {
        title: quizData.title,
        questions: quizData.quiz.map(q => ({
          question: q.question,
          options: q.options
        }))
      };
      res.json(clientQuiz);
    } else {
      console.error(`Invalid quiz data structure for quiz ${quizNumber}`);
      res.status(404).json({ error: 'Quiz not found or invalid' });
    }
  } catch (error) {
    console.error(`Error processing quiz ${quizNumber}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// クイズ結果送信API
app.post('/elearning/api/quiz/:quizNumber/submit', async (req, res) => {
  const quizNumber = req.params.quizNumber;
  const quizData = await readQuizData(quizNumber);
  const { userId, answers } = req.body;

  if (!quizData || !quizData.quiz) {
    return res.status(404).json({ error: 'Quiz not found' });
  }

  let score = 0;
  quizData.quiz.forEach((question, index) => {
    if (arraysEqual(answers[index].sort(), question.correct_answers.sort())) {
      score++;
    }
  });

  const totalQuestions = quizData.quiz.length;
  const passed = (score / totalQuestions) >= 0.7; // 70%以上で合格

  try {
    // ユーザーのテスト結果を更新
    const users = await readCsv();
    const userIndex = users.findIndex(u => u.user_id === userId.toString());
    if (userIndex !== -1) {
      users[userIndex][`test${quizNumber}`] = passed ? new Date().toISOString().split('T')[0] : '0';
      await writeCsv(users);
    }

    res.json({
      score,
      totalQuestions,
      passed
    });
  } catch (error) {
    console.error('Error updating test result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// クイズデータ読み込み関数
async function readQuizData(quizNumber) {
  try {
    const quizPath = path.join(__dirname, 'data', `${quizNumber}.json`);
    const learningPath = path.join(__dirname, 'public', 'learning', `${quizNumber}.html`);
    const title = await getHtmlTitle(learningPath);
    const data = await fs.promises.readFile(quizPath, 'utf8');
    const parsedData = JSON.parse(data);
    if (!parsedData || !parsedData.quiz || !Array.isArray(parsedData.quiz)) {
      console.error(`Invalid quiz data structure in file for quiz ${quizNumber}`);
      return null;
    }
    parsedData.title = title;
    return parsedData;
  } catch (error) {
    console.error(`Error reading quiz data for quiz ${quizNumber}:`, error);
    return null;
  }
}

function arraysEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }
  return true;
}

app.post('/elearning/api/notify-discord', async (req, res) => {
  const { userId, quizNumber, guildId, channelId } = req.body;

  if (!guildId) {
      return res.status(500).json({ error: 'Guild ID is not configured on the server' });
  }

  try {
      const users = await readCsv(); // CSVからユーザーデータを取得
      const user = users.find(u => u.user_id === userId.toString());

      if (user) {
          try {
              // Discord通知を送信
              const messageOptions = {
                  hostname: 'discord.com',
                  path: `/api/v10/channels/${channelId}/messages`,
                  method: 'POST',
                  headers: {
                      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                      'Content-Type': 'application/json'
                  }
              };
              const messageBody = JSON.stringify({
                  content: `おめでとうございます！ <@${user.user_id}>さんがクイズ${quizNumber}に合格しました！`
              });
              const discordResponse = await httpsRequest(messageOptions, messageBody);

              // Discord APIからの応答を確認
              if (discordResponse.statusCode !== 200) {
                  throw new Error(`Discord API returned status code ${discordResponse.statusCode}`);
              }

              // ロールを付与
              const roleAssigned = await assignRole(guildId, userId, 'プログラマ');

              if (roleAssigned) {
                  console.log(`Role assigned for user ${userId}`);
                  res.json({ success: true });
              } else {
                  console.log(`Failed to assign role for user ${userId}`);
                  res.status(500).json({ error: 'Failed to assign role' });
              }

          } catch (discordError) {
              console.error('Error in Discord operations:', discordError);
              res.status(500).json({ error: 'Failed to perform Discord operations' });
          }
      } else {
          console.log(`User not found for user ID ${userId}`);
          res.status(404).json({ error: 'User not found' });
      }
  } catch (error) {
      console.error('Error in notify-discord endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// ギルド取得
async function getGuild(guildId) {
  const options = {
    hostname: 'discord.com',
    path: `/api/v10/guilds/${guildId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
    }
  };

  const response = await httpsRequest(options);
  if (response.statusCode === 200) {
    return JSON.parse(response.body);
  } else {
    console.error(`Failed to fetch guild: ${response.statusCode}`, response.body);
    throw new Error(`Failed to fetch guild: ${response.statusCode}`);
  }
}

// メンバー取得
async function getGuildMember(guildId, userId) {
  const options = {
    hostname: 'discord.com',
    path: `/api/v10/guilds/${guildId}/members/${userId}`,
    method: 'GET',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
    }
  };

  const response = await httpsRequest(options);
  if (response.statusCode === 200) {
    return JSON.parse(response.body);
  } else {
    console.error(`Failed to fetch guild member: ${response.statusCode}`, response.body);
    throw new Error(`Failed to fetch guild member: ${response.statusCode}`);
  }
}

// メンバー編集
async function modifyGuildMember(guildId, userId, data) {
  const options = {
    hostname: 'discord.com',
    path: `/api/v10/guilds/${guildId}/members/${userId}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    // データの内容を確認
    console.log('Modify Guild Member Data:', data);

    const response = await httpsRequest(options, JSON.stringify(data));
    if (response.statusCode === 200) {
      return JSON.parse(response.body);
    } else {
      console.error(`Discord API Response: ${response.body}`); // Discord APIの応答を出力
      throw new Error(`Failed to modify guild member: ${response.statusCode}`);
    }
  } catch (error) {
    console.error('Error modifying guild member:', error);
    throw error;
  }
}


// ロール付与
async function assignRole(guildId, userId, roleName) {
  try {
    const guild = await getGuild(guildId);
    if (!guild) {
      console.error(`Guild not found for ID: ${guildId}`);
      return false;
    }
    
    const role = guild.roles.find(r => r.name === roleName);
    if (!role) {
      console.error(`Role "${roleName}" not found in the guild.`);
      return false;
    }

    const member = await getGuildMember(guildId, userId);
    if (!member) {
      console.error(`Member not found for user ID: ${userId}`);
      return false;
    }

    // 既存のロールと新しいロールを結合して重複を取り除く
    const newRoles = Array.from(new Set([...member.roles, role.id]));

    console.log(`Assigning role "${roleName}" to user ${userId}. New roles:`, newRoles);

    await modifyGuildMember(guildId, userId, { roles: newRoles });
    console.log(`Assigned role "${roleName}" to user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error assigning role:', error);
    return false;
  }
}


// ロール剥奪
async function removeRole(guildId, userId, roleName) {
  try {
    const guild = await getGuild(guildId);
    const role = guild.roles.find(r => r.name === roleName);
    
    if (!role) {
      console.error(`Role "${roleName}" not found in the guild.`);
      return;
    }
    
    const member = await getGuildMember(guildId, userId);
    const newRoles = member.roles.filter(r => r !== role.id);
    
    await modifyGuildMember(guildId, userId, { roles: newRoles });
    console.log(`Removed role "${roleName}" from user ${userId}`);
  } catch (error) {
    console.error('Error removing role:', error);
  }
}

// CSVファイルから行を読み込む
async function readCsvRows() {
  const results = [];
  const fileStream = fs.createReadStream(CSV_FILE);
  
  return new Promise((resolve, reject) => {
    fileStream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// 新しいユーザーをCSVに追加する
async function addNewUserToCsv(userId, name) {
  const rows = await readCsvRows();
  const newUser = {
    name: name,
    user_id: userId,
    // 他のフィールドはデフォルト値を設定
    learning001: '0',
    learning002: '0',
    learning003: '0',
    learning006: '0',
    learningNumber: '0',
    test001: '0',
    test002: '0'
  };
  rows.push(newUser);

  const csvWriter = createCsvWriter({
    path: CSV_FILE,
    header: Object.keys(rows[0]).map(key => ({ id: key, title: key }))
  });

  await csvWriter.writeRecords(rows);
  console.log(`New user added to CSV: ${userId}`);
}

// 柔軟なルーティング
app.get(['/elearning', '/elearning/', '//elearning', '//elearning/', '/elearning/index.html', '//elearning/index.html'], (req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

app.use((req, res, next) => {
  res.status(404).send("Sorry, that page doesn't exist. URL: " + req.url);
});

// HTTPSリクエストを行う関数を定義
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
              data += chunk;
          });
          res.on('end', () => {
              resolve({
                  statusCode: res.statusCode,
                  headers: res.headers,
                  body: data
              });
          });
      });

      req.on('error', (error) => {
          reject(error);
      });

      if (postData) {
          req.write(postData);
      }
      req.end();
  });
}

const server = http.createServer(app);
server.listen(port, '0.0.0.0', () => {
  console.log(`HTTP Server running on port ${port}`);
});

// const server = https.createServer(options, app);
// server.listen(port, '0.0.0.0', () => {
//   console.log(`HTTPS Server running on port ${port}`);
// });
