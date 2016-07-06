var express = require('express');
var util = require('./lib/utility');
var partials = require('express-partials');
var bodyParser = require('body-parser');
var bcrypt = require('bcryptjs');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var passport = require('passport');
var passport2 = require('passport-local');
var GitHubStrategy = require('passport-github').Strategy;

var db = require('./app/config');
var Users = require('./app/collections/users');
var User = require('./app/models/user');
var Links = require('./app/collections/links');
var Link = require('./app/models/link');
var Click = require('./app/models/click');
var app = express();
passport.use(new GitHubStrategy({
  clientID: '28ba713ebb135d1dac98',
  clientSecret: '89fe81d19f16b7674073c5c7df9d7ccc56056925',
  callbackURL: "http://127.0.0.1:4568/auth/github/callback"
},
  function(accessToken, refreshToken, profile, cb) {
    User.findOrCreate({ githubId: profile.id }, function (err, user) {
      return cb(err, user);
    });
  }
));

passport.serializeUser(function(user, done) {
  done(null, user.id); 
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});


app.use(passport.initialize());
app.use(passport.session());
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.use(partials());
// Parse JSON (uniform resource locators)
app.use(bodyParser.json());
// Parse forms (signup/login)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());


app.use(function (req, res, next) {
  // check if client sent cookie
  var cookie = req.cookies.cookieName;
  if (cookie === undefined) {
    // no: set a new cookie
    var randomNumber = Math.random().toString();
    randomNumber = randomNumber.substring(2, randomNumber.length);
    res.cookie('cookieName', randomNumber, { maxAge: 9000, httpOnly: true });
    console.log('cookie created successfully');
  } else {
    // yes, cookie was already present 
    console.log('cookie exists', cookie);
  } 
  next(); // <-- important!
});

app.use(express.static(__dirname + '/public'));
// app.use(session({
//   secret: 'tryrtyrty',
//   resave: true,
//   saveUninitialized: true
// }));

var checkUser = function(req, res) {
  new User({ username: req.body.username }).fetch().then(function(found) {
    if (found) {
      res.redirect('/signup');
    } else {
      var salt = bcrypt.genSaltSync(10);
      var hash = bcrypt.hashSync(req.body.password, salt);
      console.log('salt: ', salt);
      console.log('hash: ', hash);
      Users.create({
        username: req.body.username,
        password: hash,
        salt: salt
      })
      .then(function(user) {
        res.redirect('/');
      });
    }
  });
};

var restrict = function(req, res, next) {
  console.log('its in the restrict function', req.session);
  if (req.session.user) {
    next();
  } else {
    req.session.error = 'Access denied!';
    res.render('login');
  }
};

app.post('/signup', 
function(req, res) {
  console.log('here is the cookie(s)', req.cookies);
  checkUser(req, res);
});

app.get('/logout',
function(req, res) {
  res.redirect('/signup');
  req.session.destroy(function() {
    console.log('itlsw');
  });
});

app.post('/login'
  ,
  passport.authenticate('github', 
    { successRedirect: '/', 
      failureRedirect: '/login',
      failureFlash: true } ));
// function(req, res) {
//   console.log('here is the cookie', req.session.cookie);
//   new User({ username: req.body.username}).fetch().then(function(foundUser) {
//     if (foundUser) {
//       var hash = bcrypt.hashSync(req.body.password, foundUser.attributes.salt);
//       new User({ username: req.body.username, password: hash }).fetch().then(function(found) {
//         if (found) {

//           req.session.user = req.body.username;
//           console.log(req.session.user);
//           res.redirect('/');

//         } else {
//           console.log('bad login');
//           res.redirect('/login');
//         }
//       });
//     } else {
//       console.log('bad login');
//       res.redirect('/login');
//     }
//   });
// });

app.get('/', restrict,
function(req, res) {
  res.render('index');
});

app.get('/signup', 
function(req, res) {
  res.render('signup');
});

app.get('/login', 
function(req, res) {
  res.render('login');
});

app.get('/create', 
function(req, res) {
  res.render('index');
});

app.get('/links', 
function(req, res) {

  new User({ username: req.session.user }).fetch().then(function(user) {
    console.log(user);
    Links.reset().fetch().then(function(links) {
      var final = [];
      for (var i = 0; i < links.models.length; i++) {
        if (links.models[i].attributes.userId === user.attributes.id) {
          final.push(links.models[i]);
        }
      }

      res.status(200).send(final);
    });
  });
});

app.post('/links', 
function(req, res) {
  var uri = req.body.url;

  if (!util.isValidUrl(uri)) {
    console.log('Not a valid url: ', uri);
    return res.sendStatus(404);
  }

  new User({ username: req.session.user }).fetch().then(function(user) {
    new Link({ url: uri, userId: user.attributes.id }).fetch().then(function(found) {
      if (found) {
        res.status(200).send(found.attributes);
      } else {
        util.getUrlTitle(uri, function(err, title) {
          if (err) {
            // console.log('Error reading URL heading: ', err);
            return res.sendStatus(404);
          }

          Links.create({
            url: uri,
            title: title,
            baseUrl: req.headers.origin,
            userId: user.attributes.id
          })
          .then(function(newLink) {
            res.status(200).send(newLink);
          });
        });
      }
    });
  });
});

/************************************************************/
// Write your authentication routes here
/************************************************************/



/************************************************************/
// Handle the wildcard route last - if all other routes fail
// assume the route is a short code and try and handle it here.
// If the short-code doesn't exist, send the user to '/'
/************************************************************/

app.get('/*', function(req, res) {
  new User({ username: req.session.user || req.body.username }).fetch().then(function(user) {
    new Link({ code: req.params[0], userId: user.attributes.id }).fetch().then(function(link) {
      if (!link) {
        res.redirect('/');
      } else {
        var click = new Click({
          linkId: link.get('id')
        });

        click.save().then(function() {
          link.set('visits', link.get('visits') + 1);
          link.save().then(function() {
            return res.redirect(link.get('url'));
          });
        });
      }
    });
  });
});

console.log('Shortly is listening on 4568');
app.listen(4568);
