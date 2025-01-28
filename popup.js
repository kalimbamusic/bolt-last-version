document.getElementById('extractHours').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const targetUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/Attendance/calendarpage.aspx?isOnSelf=true';
    const homeUrl = 'https://smkb-sso.net.hilan.co.il/Hilannetv2/ng/personal-file/home';
    const hrPortalUrl = 'https://hrm-portal.malam-payroll.com/timesheets/timesheets-report/calendar';

    // Function to wait for navigation
    const waitForNavigation = (tabId) => {
      return new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    };

    // Function to check if the current URL matches the target URL
    const isTargetPage = (url) => {
      return url === targetUrl;
    };

    // Function to navigate to the target URL and handle redirects
    const navigateToTarget = async (tabId) => {
      let currentTab = await chrome.tabs.get(tabId);
      let attempts = 0;
      const maxAttempts = 3;

      while (!isTargetPage(currentTab.url) && attempts < maxAttempts) {
        if (currentTab.url === homeUrl) {
          console.log('Landed on home page, redirecting to target...');
        } else {
          console.log('Not on target page, redirecting...');
        }
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForNavigation(tabId);
        currentTab = await chrome.tabs.get(tabId);
        attempts++;
        // Give the page a moment to fully load
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      if (!isTargetPage(currentTab.url)) {
        throw new Error('Failed to navigate to the target page after multiple attempts.');
      }
    };

    // Navigate to the target URL
    await navigateToTarget(tab.id);

    // Step 1: Select all relevant days
    console.log('Step 1: Selecting days...');
    const selectionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: selectHilanDays
    });
    console.log('Selection completed:', selectionResult[0].result);

    // Step 2: Wait for a moment and click the "Selected Days" button
    console.log('Step 2: Clicking Selected Days button...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: clickSelectedDaysButton
    });

    // Step 3: Wait for the table to load and then extract data
    console.log('Step 3: Waiting for table and extracting data...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractDetailedHours
    });
    
    console.log('Extraction completed:', result[0].result);
    displayResults(result[0].result);

    // Step 4: Navigate to HR Portal and inject data
    if (result[0].result && result[0].result.length > 0) {
      console.log('Navigating to HR Portal...');
      await chrome.tabs.update(tab.id, { url: hrPortalUrl });
      
      // Wait for a short time to allow partial loading
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Inject and execute the data injection function
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab.url;
        if (currentUrl === hrPortalUrl) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: injectHoursToHRPortal,
            args: [result[0].result]
          });
        } else {
          console.log('Not on HR Portal page, skipping injection.');
        }
      } catch (error) {
        console.error('Error injecting script:', error);
      }
    }
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('result').textContent = 'Error: ' + error.message;
  }
});

function displayResults(data) {
  const resultDiv = document.getElementById('result');
  console.log('Raw data:', data);
  
  if (!data || data.length === 0) {
    resultDiv.textContent = 'No hours found. Debug info: ' + JSON.stringify(data);
    return;
  }

  // Create a Map to store unique dates
  const uniqueDays = new Map();
  data.forEach(day => {
    const date = parseInt(day.date);
    if (!isNaN(date) && date <= 31 && !uniqueDays.has(date)) {
      uniqueDays.set(date, day);
    }
  });

  console.log('Unique days:', Array.from(uniqueDays.values()));

  // Convert Map to array and sort by date
  const sortedDays = Array.from(uniqueDays.values())
    .sort((a, b) => parseInt(a.date) - parseInt(b.date));

  // Get the year from the first entry (they should all be the same)
  const year = sortedDays[0]?.year || new Date().getFullYear().toString();

  const table = document.createElement('table');
  table.innerHTML = `
    <tr>
      <th colspan="4" style="text-align: center; background-color: #f8f9fa;">Year: ${year}</th>
    </tr>
    <tr>
      <th>Date</th>
      <th>Entrance</th>
      <th>Exit</th>
      <th>Total</th>
    </tr>
    ${sortedDays.map(day => `
      <tr>
        <td>${day.date}</td>
        <td>${day.entrance || '-'}</td>
        <td>${day.exit || '-'}</td>
        <td>${day.total || '-'}</td>
      </tr>
    `).join('')}
  `;
  
  resultDiv.innerHTML = '';
  resultDiv.appendChild(table);
}

function selectHilanDays() {
  // Find all date cells
 const dateCells = document.querySelectorAll('td[class*="cDIES"]');
  let selectedCount = 0;

  dateCells.forEach(cell => {
    // Check if the cell has a valid time entry
    const timeCell = cell.querySelector('.cDM');
    const dateCell = cell.querySelector('.dTS');
    
    if (timeCell && timeCell.textContent.trim() !== '' && 
        dateCell && parseInt(dateCell.textContent.trim()) <= 31) {
      // If not already selected
      if (!cell.classList.contains('CSD')) {
        cell.click();
        selectedCount++;
      }
    }
  });

  return `Selected ${selectedCount} dates`;
}

function clickSelectedDaysButton() {
  const selectedDaysButton = document.getElementById('ctl00_mp_RefreshSelectedDays');
  if (selectedDaysButton) {
    console.log('Clicking selected days button');
    selectedDaysButton.click();
    return true;
  } else {
    console.error('Selected days button not found');
    return false;
  }
}

function extractDetailedHours() {
  const days = [];
  
  // Extract year from the month selector
  const monthSelector = document.getElementById('ctl00_mp_calendar_monthChanged');
  const yearMatch = monthSelector?.textContent.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
  
  // Get all rows from the detailed view
  const detailsTable = document.querySelector('table[id*="RG_Days_"]');
  if (!detailsTable) {
    console.error('Details table not found');
    return days;
  }

  const rows = detailsTable.querySelectorAll('tr[id*="_row_"]');
  console.log('Found detail rows:', rows.length);
  
  rows.forEach((row, index) => {
    try {
      // Get all cells in the row
      const cells = row.getElementsByTagName('td');
      console.log(`Processing row ${index}:`, cells.length, 'cells');
      
      if (cells.length >= 4) {
        const date = cells[0]?.textContent?.trim();
        
        // Extract entrance time (from the third column)
        const entranceInput = cells[5]?.querySelector('input[id*="ManualEntry"]');
        const entrance = entranceInput?.value || cells[5]?.getAttribute('ov') || '';
        
        // Extract exit time (from the fourth column)
        const exitInput = cells[6]?.querySelector('input[id*="ManualExit"]');
        const exit = exitInput?.value || cells[6]?.getAttribute('ov') || '';
        
        // Extract total time (from the first column after date)
        const totalCell = cells[7];
        let total = '';
        
        if (totalCell) {
          // Try to get total from span first
          const totalSpan = totalCell.querySelector('span[class*="ROC"]');
          if (totalSpan) {
            total = totalSpan.textContent.trim();
          } else {
            // Fallback to cell's ov attribute
            total = totalCell.getAttribute('ov') || '';
          }
        }
        
        console.log('Row data:', { date, entrance, exit, total, year });
        
        if (date && parseInt(date) <= 31) {
          days.push({
            date,
            entrance,
            exit,
            total,
            year
          });
        }
      }
    } catch (error) {
      console.error('Error processing row:', error);
    }
  });
  
  console.log('Extracted days:', days);
  return days;
}

function injectHoursToHRPortal(hoursData) {
  console.log('injectHoursToHRPortal function is running');
  
  // Helper function to get the day of the week number (0-6)
  function getDayOfWeekNumber(date) {
    return date.getDay();
  }

  async function processDay(dayData) {
    console.log('Processing day:', dayData);
    try {
      // Format the date to ensure it's two digits (e.g., "1" becomes "01")
      const formattedDate = dayData.date.padStart(2, '0');
      
      // Get the current month (01-12)
      const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
      
      // Create a valid date object
      const dateObj = new Date(parseInt(dayData.year), parseInt(currentMonth) - 1, parseInt(formattedDate));
      
      // Get the day of the week number
      const dayOfWeekNumber = getDayOfWeekNumber(dateObj);
      
      // Create the full date format including the day of the week
      const fullDateWithDay = `dow${dayOfWeekNumber} d${dayData.year}-${currentMonth}-${formattedDate}`;
      console.log('Full date with day:', fullDateWithDay);
      
      // Store formatted dates for debugging
      const formattedDates = [];
      formattedDates.push(fullDateWithDay);
      console.log('Formatted dates:', formattedDates);
      
      // Find the day element directly using the full date format
      const dayElement = document.querySelector(`div.cv-day[class*="${fullDateWithDay}"]`);
      
      if (!dayElement) {
        console.error(`Day element not found for date: ${fullDateWithDay}`);
        
        // Attempt to find the element using regex
        const regex = new RegExp(`d${dayData.year}-\\d{2}-${formattedDate}.*`);
        const dayElementRegex = Array.from(document.querySelectorAll('div.cv-day'))
          .find(el => regex.test(el.className));
        
        if (dayElementRegex) {
          console.log('Found element using regex:', dayElementRegex);
          dayElementRegex.click();
        } else {
          console.error('Element not found using regex either');
          return;
        }
      } else {
        console.log('Clicking day element:', dayElement);
        dayElement.click();
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Click the "Add Report" button
      const addButton = document.querySelector('span.v-btn__content i.far.fa-plus')?.closest('button');
      if (!addButton) {
        console.error('Add report button not found');
        return;
      }
      console.log('Clicking add button:', addButton);
      addButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Fill in entrance time
      const entranceInput = document.querySelector('input[aria-label="שדה טקסט שעת כניסה"]');
      if (entranceInput && dayData.entrance) {
        console.log('Filling entrance time:', dayData.entrance);
        entranceInput.value = dayData.entrance;
        entranceInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Fill in exit time
      const exitInput = document.querySelector('input[aria-label="שדה טקסט שעת יציאה"]');
      if (exitInput && dayData.exit) {
        console.log('Filling exit time:', dayData.exit);
        exitInput.value = dayData.exit;
        exitInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Click save button
      const saveButton = Array.from(document.querySelectorAll('span.v-btn__content'))
        .find(span => span.textContent.includes('שמירה'))
        ?.closest('button');
      
      if (saveButton) {
        console.log('Clicking save button:', saveButton);
        saveButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error('Save button not found');
      }
    } catch (error) {
      console.error(`Error processing day ${dayData.date}:`, error);
    }
  }

  // Process each day sequentially
  async function processAllDays() {
    for (const dayData of hoursData) {
      await processDay(dayData);
      // Wait between processing days to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Start processing
  processAllDays().then(() => {
    console.log('Finished processing all days');
  }).catch(error => {
    console.error('Error processing days:', error);
  });
}

function getDayOfWeekHebrew(date) {
  const daysOfWeek = [
    'א\'',
    'ב\'',
    'ג\'',
    'ד\'',
    'ה\'',
    'ו\'',
    'שבת'
  ];
  return daysOfWeek[date.getDay()];
}
