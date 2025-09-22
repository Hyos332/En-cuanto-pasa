module.exports.registerCommands = (app) => {
  require('./bus')(app);
  require('./bushelp')(app);
  require('./cancion')(app);
};
