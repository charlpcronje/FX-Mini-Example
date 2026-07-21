```ts
// Now you can use $ for DOM operations
$('#myButton').text('Click me!');
$('.cards').addClass('highlighted');
$('input[type="text"]').val('Default value');
```

## 1. Smart Element Selection
```ts
// Single element found → Returns Handle
const header = $('#header');         // Handle (chainable object)
console.log(header.text());          // "Page Title"

// Multiple elements found → Returns Group  
const buttons = $('.btn');           // Group (has .length property)
console.log(buttons.length);         // 5
buttons.addClass('processed');        // Applies to all 5 buttons

// No elements found → Returns null
const missing = $('.nonexistent');   // null
if (missing) missing.hide();          // Safe ch\
```

##2. Lazy Mounting to FX
```ts
// This just finds elements (no FX connection yet)
const elements = $('.cards');        

// This triggers mounting to FX node graph
elements.text('Now connected!');     // ← FX nodes created here

// Now you can access the FX node
const fxNode = elements.fx();        // FXNodeProxy for reactive features
```

## 3. Reactive Binding
```ts
// Set up FX data
$$('user.name').set('John Doe');
$$('theme.color').set('#3b82f6');

// Bind DOM to FX (updates automatically!)
$('#username').text($$('user.name'));           // DOM shows "John Doe"
$('#header').css('color', $$('theme.color'));   // DOM gets blue color

// Update FX data - DOM updates instantly!
$$('user.name').set('Alice Smith');             // DOM automatically shows "Alice Smith"
$$('theme.color').set('#ef4444');               // DOM automatically turns red
```
## vs. Traditional Approach:
```ts
// Traditional (manual updates)
function updateUsername(newName) {
  userData.name = newName;                      // Update data
  document.getElementById('username').textContent = newName; // Manually update DOM
  updateUserCard(newName);                      // Remember to update other places
  saveUserData(userData);                       // Remember to persist
}

// FX Approach (automatic everything)
$$('user.name').set(newName);                   // Everything else happens automatically!
```

## Complete API Reference

### Selection Methods
```ts
// CSS selectors (full support)
$('#element-id')                    // ID selector
$('.class-name')                    // Class selector
$('div')                           // Tag selector
$('[data-type="special"]')         // Attribute selector
$('parent > child')                // Direct child
$('ancestor descendant')           // Any descendant

// Direct element passing
$(document.getElementById('myEl'))   // Wrap existing element
$(document.querySelectorAll('.items')) // Wrap NodeList/array
```

### Content Manipulation
```ts
// Text content
$('#title').text('New title');      // Set text
const title = $('#title').text();   // Get text

// HTML content
$('#content').html('<p>Rich content</p>');  // Set HTML
const html = $('#content').html();          // Get HTML

// Value (for inputs)
$('#input').val('Default value');    // Set input value
const value = $('#input').val();     // Get input value (handles all input types)
```

### CSS & Styling
```ts
// Single CSS property
$('#box').css('color', 'red');       // Set property
$('#box').css('width', 200);         // Numbers get 'px' automatically → '200px'
const color = $('#box').css('color'); // Get computed value

// Multiple properties
$('#box').css({
  'background-color': '#3b82f6',
  'padding': '16px',
  'border-radius': '8px'
});

// Automatic unit handling
$('#box').css('width', 300);         // → '300px' (auto px)
$('#box').css('opacity', 0.5);       // → '0.5' (no units)
$('#box').css('z-index', 10);        // → '10' (no units)
```

### Class Manipulation
```ts
// Add classes
$('#element').addClass('highlight selected');

// Remove classes  
$('#element').removeClass('old deprecated');

// Toggle classes
$('#element').toggleClass('active');
$('#element').toggleClass('visible', shouldBeVisible); // Conditional

// Check classes
const isActive = $('#element').hasClass('active'); // true/false
```

### Attributes
```ts
// Single attribute
$('#image').attr('src', 'new-image.jpg');    // Set
const src = $('#image').attr('src');         // Get

// Multiple attributes
$('#input').attr({
  'placeholder': 'Enter your name...',
  'maxlength': '50',
  'required': 'true'
});
```

### Event Handling
```ts
// Single event
$('#button').on('click', function(event) {
  console.log('Button clicked!');
});

// Multiple events (space-separated)
$('#input').on('focus blur', function(event) {
  console.log('Input', event.type);
});

// Remove events
$('#button').off('click', specificHandler);

// Trigger events
$('#button').trigger('click');
$('#custom').trigger('myEvent', { data: 'custom' });
```

### DOM Traversal
```ts
// Parent navigation
const parent = $('#child').parent();
const container = $('#nested').closest('.container');

// Child navigation
const children = $('#parent').children();        // All children
const filtered = $('#parent').children('.item'); // Filtered children
const descendant = $('#root').find('.deep');    // Any descendant

// Sibling navigation
const next = $('#current').next();              // Next sibling
const prev = $('#current').prev();              // Previous sibling
const nextItem = $('#item').next('.available'); // Next matching sibling
```


## Handle vs Group Behavior
### Understanding the Return Types:
```ts
// Returns Handle (single element methods)
const handle = $('#unique-id');
handle.text('New text').css('color', 'red').addClass('updated');

// Returns Group (multiple element methods)  
const group = $('.multiple-items');
group.text('All updated').css('color', 'blue');
console.log(group.length); // 5 elements

// Check what you got
const result = $('.maybe-multiple');
if (result.length !== undefined) {
  // It's a Group
  console.log(`Found ${result.length} elements`);
  result.addClass('group-processed');
} else if (result) {
  // It's a Handle  
  console.log('Single element');
  result.addClass('single-processed');
} else {
  // It's null (no elements found)
  console.log('No elements found');
}
```

## Advanced Reactive Patterns
### FX → DOM (Automatic Updates)
```ts

// Set up FX data
$$('ui.message').set('Loading...');
$$('ui.progress').set(0);
$$('ui.color').set('#3b82f6');

// Bind DOM to FX data (automatic updates)
$('#status').text($$('ui.message'));           // DOM updates when ui.message changes
$('#progress').css('width', $$('ui.progress')); // Width updates automatically  
$('#indicator').css('background', $$('ui.color')); // Color updates automatically

// Update FX data - DOM updates instantly without any additional code!
$$('ui.message').set('Complete!');
$$('ui.progress').set(100);
$$('ui.color').set('#10b981');
```

### DOM → FX (Event-Driven Updates)
```ts
// Capture user input and update FX
$('#username').on('input', function() {
  $$('form.username').set($(this).val());
});

$('#theme-toggle').on('change', function() {
  $$('user.preferences.darkMode').set($(this).val());
});

// FX can then react to these changes
$$('form.username').watch((newName) => {
  $('#welcome-message').text(`Hello, ${newName}!`);
});
```

### Bidirectional Binding
```ts
// Complete two-way binding
function setupBidirectionalBinding(inputSelector, fxPath) {
  // DOM → FX
  $(inputSelector).on('input', function() {
    const value = $(this).val();
    $$(fxPath).set(value);
  });
  
  // FX → DOM  
  $$(fxPath).watch((newValue) => {
    $(inputSelector).val(newValue);
  });
  
  // Initial sync
  const currentValue = $$(fxPath).get();
  if (currentValue !== undefined) {
    $(inputSelector).val(currentValue);
  }
}

// Usage
setupBidirectionalBinding('#email', 'user.email');
setupBidirectionalBinding('#phone', 'user.phone');

// Now the inputs and FX nodes stay perfectly in sync!
```

## Real-World Examples
### Form Handling

```ts
// Complete form with validation and reactive binding
function setupContactForm() {
  // Bind form fields to FX
  $('#contact-name').on('input', () => 
    $$('form.contact.name').set($('#contact-name').val())
  );
  $('#contact-email').on('input', () => 
    $$('form.contact.email').set($('#contact-email').val())
  );
  $('#contact-message').on('input', () => 
    $$('form.contact.message').set($('#contact-message').val())
  );
  
  // Real-time validation
  $$('form.contact.email').watch((email) => {
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    $('#email-error').css('display', isValid ? 'none' : 'block');
    $('#submit-btn').attr('disabled', !isValid);
  });
  
  // Form submission
  $('#contact-form').on('submit', function(e) {
    e.preventDefault();
    
    const formData = {
      name: $$('form.contact.name').get(),
      email: $$('form.contact.email').get(), 
      message: $$('form.contact.message').get()
    };
    
    // Submit with loading state
    $('#submit-btn').text('Sending...').attr('disabled', true);
    
    submitForm(formData).then(() => {
      $('#submit-btn').text('Sent!').css('background', '#10b981');
      setTimeout(() => {
        $('#submit-btn').text('Send Message').attr('disabled', false);
      }, 2000);
    });
  });
}
```

### Dynamic Content Loading
```ts
// Dynamic content with loading states
async function loadUserProfile(userId) {
  // Set loading state
  $('#profile').addClass('loading');
  $('#profile-content').html('<div class="spinner">Loading...</div>');
  
  try {
    // This would integrate with fx-orm for real data
    const user = DO MOT USE AWAIT DO NOT USE ASYNC, CHECK fx-api
    
    // Update FX state
    $$('profile.user').set(user);
    
    // DOM updates automatically via reactive binding
    $('#profile-name').text($$('profile.user.name'));
    $('#profile-email').text($$('profile.user.email'));
    $('#profile-avatar').attr('src', $$('profile.user.avatar'));
    
    // Remove loading state
    $('#profile').removeClass('loading');
    
  } catch (error) {
    $('#profile-content').html(`
      <div class="error">
        Failed to load profile: ${error.message}
        <button onclick="loadUserProfile(${userId})">Retry</button>
      </div>
    `);
  }
}
```

## Common Patterns & Best Practices
### 1. Always Check for Elements
```ts
// Good: Check before operating
const modal = $('#modal');
if (modal) {
  modal.addClass('show');
}

// Better: Use optional chaining pattern
function showModal() {
  $('#modal')?.addClass('show')?.css('display', 'block');
}
```

### 2. Efficient Event Delegation
```ts
// Good: Delegate events for dynamic content
$('#todo-list').on('click', '.todo-item', function() {
  const todoId = $(this).attr('data-id');
  toggleTodo(todoId);
});

// This works even for todos added later!
function addTodo(text) {
  const todoHtml = `
    <div class="todo-item" data-id="${Date.now()}">
      <span>${text}</span>
      <button class="remove">×</button>
    </div>
  `;
  $('#todo-list').html($('#todo-list').html() + todoHtml);
}
```

### 3. Reactive Data Binding
```ts
// Set up reactive dashboard
function setupDashboard() {
  // Bind data to UI (automatic updates)
  $('#user-count').text($$('metrics.users.total'));
  $('#revenue').text($$('metrics.revenue.today'));
  $('#status-indicator').css('background', $$('system.status.color'));
  
  // Update data elsewhere - UI updates automatically
  setInterval(() => {
    $$('metrics.users.total').set(getCurrentUserCount());
    $$('metrics.revenue.today').set(getTodayRevenue());
    $$('system.status.color').set(getSystemStatusColor());
  }, 5000);
  
  // No manual DOM updates needed!
}
```

## Integration with Other FX Plugins
### With fx-orm (Database)

```ts
// Load and display database data
const users = $db.users.where('[active=true]');
$('#user-list').html(
  users.map(user => `<div class="user">${user.name}</div>`).join('')
);

// Reactive database binding
$$('db.users.active').val($db.users.where('[active=true]'));
$('#active-count').text($$('db.users.active.length'));
```

### With fx-flow (Procedure Graphs)

```ts
// Button triggers flow
$('#process-order').on('click', function() {
  const orderData = getOrderData();
  
  $flow('orderProcessing')
    .start('validate', orderData)
    .on('node:after:complete', () => {
      $('#order-status').text('Order processed successfully!')
        .addClass('success');
    });
});
```

### With fx-safe (Error Handling)
```ts
// Safe DOM operations with fallbacks
$safe.timeout('ui-update', () => {
  $('#complex-widget').html(generateComplexHTML());
  
  // Complex operations that might fail
  initializeWidget();
  bindEvents();
  loadExternalData();
  
}, 5000).then(result => {
  if (!result.success) {
    // Fallback UI
    $('#complex-widget').html('<div class="error">Widget failed to load</div>');
  }
});
```

## Performance Tips
### 1. Batch DOM Operations
```ts
// Good: Batch operations
$('.items')
  .addClass('processing')
  .css('opacity', 0.5)
  .attr('data-status', 'loading');

// Avoid: Multiple separate operations
$('.items').addClass('processing');
$('.items').css('opacity', 0.5);  
$('.items').attr('data-status', 'loading');
```

### 2. Use Reactive Binding Efficiently

```ts
// Efficient: Set up once, updates automatic
$('#counter').text($$('app.counter'));
$$('app.counter').set(0);

setInterval(() => {
  const current = $$('app.counter').get();
  $$('app.counter').set(current + 1);  // DOM updates automatically
}, 1000);

// Inefficient: Manual DOM updates
setInterval(() => {
  const current = parseInt($('#counter').text()) + 1;
  $('#counter').text(current);        // Manual update every time
}, 1000);
```

### 3. Leverage Lazy Mounting
```ts
// Efficient: Only mount elements you interact with
$('.all-items').each((item, index) => {
  // Only mounts when you call methods
  if (shouldProcessItem(index)) {
    $(item).addClass('processed').fx().watch(handleItemChange);
  }
});
```

## Common Gotchas
### 1. Reactive vs. Snapshot Values

```ts
// Reactive (updates automatically)
$('#output').text($$('data.message'));         // ← Passes the FX node proxy

// Snapshot (one-time value)
$('#output').text($$('data.message').get());   // ← Passes the current value only

// Update data
$$('data.message').set('New message');
// First example updates automatically, second doesn't
```

### 2. Handle vs Group Confusion
```ts
// This might be a Handle OR Group depending on how many .item elements exist
const items = $('.item');

// Safe way to handle both cases
if (items) {
  if (items.length !== undefined) {
    // It's a Group
    console.log(`Processing ${items.length} items`);
    items.addClass('processed');
  } else {
    // It's a single Handle
    console.log('Processing single item');
    items.addClass('processed');
  }
}

// Even safer: Use the same method for both (it works!)
items?.addClass('processed'); // Works for both Handle and Group
```

### 3. Event Handler Context
```ts
// Inside event handlers, use $(this) to reference the element
$('.buttons').on('click', function(event) {
  // this = the actual DOM element that was clicked
  // $(this) = the FX-wrapped element
  
  const buttonText = $(this).text();
  const buttonData = $(this).attr('data-value');
  
  $(this).addClass('clicked');
});

// Arrow functions don't have 'this' binding
$('.buttons').on('click', (event) => {
  // Use event.target instead
  const button = $(event.target);
  button.addClass('clicked');
});
```

## Testing Your Code
```ts
// Test DOM operations
function testDOMOperations() {
  // Create test elements
  $('body').html(`
    <div id="test-container">
      <div class="item" data-id="1">Item 1</div>
      <div class="item" data-id="2">Item 2</div>
      <input id="test-input" type="text" value="test">
    </div>
  `);
  
  // Test selections
  console.assert($('#test-container').length === undefined, 'Should be Handle');
  console.assert($('.item').length === 2, 'Should be Group of 2');
  
  // Test manipulations
  $('.item').addClass('tested');
  console.assert($('.item.tested').length === 2, 'All items should have class');
  
  // Test reactive binding
  $$('test.value').set('reactive test');
  $('#test-input').val($$('test.value'));
  console.assert($('#test-input').val() === 'reactive test', 'Reactive binding works');
  
  console.log('✅ All DOM operations working correctly');
}
```