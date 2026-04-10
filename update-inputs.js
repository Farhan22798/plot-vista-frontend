const fs = require('fs');
const path = require('path');

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(file));
    } else {
      if (file.endsWith('.js')) results.push(file);
    }
  });
  return results;
}

const files = walkDir(path.join(__dirname, 'src'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  // Basic search to add placeholderTextColor="#888" to all TextInputs
  // Only insert if it's missing
  content = content.replace(/<TextInput(?![\s\S]*?placeholderTextColor)/g, '<TextInput placeholderTextColor="#888"');
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated TextInput in:', file);
  }
});
