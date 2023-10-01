const express = require("express");

//creating a instance
const app = express();

//default middleware
app.use(express.json());

const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

/*
If user1/Fan follows user2/Star then,
follower_user_id is the user ID of user1/Fan and 
following_user_id is the user ID of user2/Star.

You can first get the details of the..
logged-in user from the middleware function.

You can now use the details of the..
logged-in user to get the details of the following-users and followers
*/

//middleware function
const getFollowingUserIds = async (username) => {
  const followingUserId = `
  SELECT following_user_id 
  FROM 
  follower INNER JOIN user ON user.user_id = follower.follower_user_id 
  WHERE user.username = '${username}';`;
  const followingPeople = await db.all(followingUserId);
  const followingIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return followingIds;
};

// POST API 1 --register a user <Section id="section1" >
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
        INSERT INTO 
          user ( username, password, name, gender) 
        VALUES 
          ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      const dbResponse = await db.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

//POST API 2 --login Section <Section id="section2">
app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    res.status(400);
    res.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      const payload = { username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      res.send({ jwtToken });
    } else {
      res.status(400);
      res.send("Invalid password");
    }
  }
});

/* <Section id="authToken"> */
//Write a middleware to authenticate the JWT token
// defining a middleware/function to verify in every api call..
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (authHeader === undefined) {
    res.status(401);
    res.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        res.status(401);
        res.send("Invalid JWT Token");
      } else {
        req.username = payload.username;
        req.userId = payload.userId;
        next();
      }
    });
  }
};

/**..Access tweets, likes, names, replies..*/
//middleware function
const tweetAccessVerification = async (req, res, next) => {
  const { tweetId } = req.params;
  const { userId } = req;
  const getTweetQuery = `
  SELECT *
  FROM
  tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id 
  WHERE 
   tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    next();
  }
};

// GET API 3 <Section id="section3">
/** Returns the latest tweets of people whom the user follows*/
app.get(`/user/tweets/feed/`, authenticateToken, async (req, res) => {
  const { username } = req;
  const getFollowingIds = await getFollowingUserIds(username);
  const getTweets = `SELECT username, tweet, date_time AS dateTime
     FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
     WHERE user.user_id IN (${getFollowingIds})
     ORDER BY date_time DESC
     LIMIT 4;`;
  const tweet = await db.all(getTweets);
  res.send(tweet);
});

// GET API 4 <Section id="section4">
/** Returns the list of all names of people whom the user follows */
app.get(`/user/following/`, authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const getFollowingUserQuery = `SELECT name FROM
    follower INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = ${userId};`;
  const following = await db.all(getFollowingUserQuery);
  res.send(following);
});

// GET API 5 <Section id="section5">
/** Returns the list of all names of people who follows the user */
app.get(`/user/followers/`, authenticateToken, async (req, res) => {
  const { username, userId } = req;
  const getFollowingUserQuery = `SELECT DISTINCT name FROM
    follower INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = ${userId};`;
  const follower = await db.all(getFollowingUserQuery);
  res.send(follower);
});

// GET API 6 <Section id="section6">
app.get(
  `/tweets/:tweetId/`,
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { username, userId } = req;
    const { tweetId } = req.params;
    /**
       If the user requests a tweet of the user he is following, 
       return the tweet, likes count, replies count and date-time
       */
    const getTweetQuery = `SELECT tweet,
      (SELECT COUNT() FROM like WHERE tweet_id =  ${tweetId}) AS likes,
      (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
      date_time AS dateTime
      FROM tweet
      WHERE tweet.tweet_id = ${tweetId};`;
    const tweets = await db.get(getTweetQuery);
    res.send(tweets);
  }
);

// GET API 7 <Section id="section7">
app.get(
  `/tweets/:tweetId/likes/`,
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { username, userId } = req;
    const { tweetId } = req.params;
    /**
    If the user requests a tweet of a user he is following, 
    return the list of usernames who liked the tweet 
    */
    const likedTweets = `SELECT username 
   FROM user
   INNER JOIN like ON user.user_id = like.user_id
   WHERE tweet_id = ${tweetId} ;`;
    const likedUser = await db.all(likedTweets);
    const likeArray = likedUser.map((eachUser) => eachUser.username);
    res.send({ likes: likeArray });
  }
);

// GET API 8 <Section id="section8">
app.get(
  `/tweets/:tweetId/replies/`,
  authenticateToken,
  tweetAccessVerification,
  async (req, res) => {
    const { tweetId } = req.params;
    /** If the user requests a tweet of a user he is following, 
    return the list of replies. */
    const getReplies = `SELECT name, reply 
   FROM user
   INNER JOIN reply ON user.user_id = reply.user_id
   WHERE tweet_id = ${tweetId} ;`;
    const repliedUser = await db.all(getReplies);
    res.send({ replies: repliedUser });
  }
);

// GET API 9 <Section id="section9">
/** ---Returns a list of all tweets of the user-- */
app.get(`/user/tweets/`, authenticateToken, async (req, res) => {
  const { userId } = req;
  const tweetsOfUsers = `
  SELECT 
   tweet,
   COUNT (DISTINCT like_id ) AS likes,
   COUNT (DISTINCT reply_id ) AS replies,
   date_time AS dateTime
   FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON
   tweet.tweet_id = like.tweet_id
   WHERE tweet.user_id = ${userId}
   GROUP BY tweet.tweet_id;`;
  const allTweets = await db.all(tweetsOfUsers);
  res.send(allTweets);
});

// POST API 10 <Section id="section10">
/** Create a tweet in the tweet table */
app.post(`/user/tweets/`, authenticateToken, async (req, res) => {
  const { tweet } = req.body;
  const userId = parseInt(req.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweet = `
  INSERT INTO tweet(tweet, user_id, date_time)
  VALUES ('${tweet}','${userId}','${dateTime}');`;
  await db.run(createTweet);
  res.send("Created a Tweet");
});

// DELETE API 11 <Section id="section11">
/**If the user requests to delete a tweet of other users, response should be invalid */
app.delete(`/tweets/:tweetId/`, authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;
  //   console.log(userId);
  const getTweetQuery = `SELECT * 
  FROM tweet 
  WHERE user_id = ${userId} AND tweet_id = ${tweetId};`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    res.status(401);
    res.send("Invalid Request");
  } else {
    const deleteTweet = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweet);
    res.send("Tweet Removed");
  }
});

/*..export..*/
module.exports = app;
