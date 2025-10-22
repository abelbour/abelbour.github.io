/**
 * --------------------------------------------------------------------
 * Main Application Logic
 * --------------------------------------------------------------------
 * This script handles the entire lifecycle of the wedding invitation page.
 * 1. It fetches guest and event data from Google Sheets.
 * 2. It waits for custom fonts to load to prevent unstyled text.
 * 3. It parses the invitation code from the URL.
 * 4. It decrypts and processes the data to dynamically build the page sections.
 * 5. It sets up navigation, scrolling, and other interactive elements.
 * 6. It includes error handling and retry mechanisms for robustness.
 * --------------------------------------------------------------------
 */

// URLs for the public Google Sheets containing guest and event data.
const googleSheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcjtPM-3LNZFamySSe9rbVOjTu1pRSQ0Te5ILx6MmF9ClbBJUZvnfPHYsIg4_CclD_7ba0lv1QMdiZ/pub?output=csv';
const eventDataUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcjtPM-3LNZFamySSe9rbVOjTu1pRSQ0Te5ILx6MmF9ClbBJUZvnfPHYsIg4_CclD_7ba0lv1QMdiZ/pub?output=csv&gid=1404690345';

/**
 * Fetches a resource with a specified number of retries to handle transient network issues.
 * @param {string} url The URL to fetch.
 * @param {number} [retries=3] The number of times to retry on failure.
 * @returns {Promise<Response>} A promise that resolves with the response.
 */
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            // Append a timestamp to the URL to prevent browser caching.
            const response = await fetch(`${url}&_=${Date.now()}`);
            if (response.ok) {
                return response;
            }
            console.warn(`Fetch attempt ${i + 1} failed with status: ${response.status}`);
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} failed with error:`, error);
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
}

/**
 * Main entry point. Fires after the initial HTML document has been completely loaded and parsed.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Wait for all custom fonts to be loaded before processing the data and showing the page.
    // This prevents a "flash of unstyled text" (FOUT).
    document.fonts.ready.then(async () => {
        try {
            // Fetch guest and event data concurrently for efficiency.
            const [guestCsvText, eventCsvText] = await Promise.all([
                fetchWithRetry(googleSheetUrl).then(res => res.text()),
                fetchWithRetry(eventDataUrl).then(res => res.text())
            ]);

            // Get the invitation code from the URL.
            const params = new URLSearchParams(window.location.search);
            const code = params.get('i');

            // Process all data and build the page.
            await processGuestData(code, guestCsvText, eventCsvText);

            // Now that data is processed and sections are visible, remove the loading class to show the content.
            document.body.classList.remove('fonts-loading');

            // Initialize interactive elements.
            setupVerticalScrolling();
        } catch (error) {
            console.error("Fatal Error:", error);
            // If fetching or initial processing fails, show a connection error message.
            const spinner = document.getElementById('loading-spinner');
            if (spinner) spinner.style.display = 'none';
            
            const errorSection = document.querySelector('[data-section="no-code"]');
            if(errorSection) {
                displayMessage('connection-error-message');
            }
        }
    });
});

/**
 * Sets up the vertical scrolling behavior for each section, including the appearance
 * of up/down buttons and fade overlays based on scroll position.
 */
function setupVerticalScrolling() {
    document.querySelectorAll('.scroll-section').forEach(section => {
        const scrollableContent = section.querySelector('.scrollable-content');
        const upButton = section.querySelector('.scroll-v-button.up');
        const downButton = section.querySelector('.scroll-v-button.down');
        const topFade = section.querySelector('.fade-overlay.top');
        const bottomFade = section.querySelector('.fade-overlay.bottom');

        if (!scrollableContent || !upButton || !downButton || !topFade || !bottomFade) return;

        // Checks if the content overflows and adds/removes scroll listeners accordingly.
        const checkOverflow = () => {
            const hasOverflow = scrollableContent.scrollHeight > scrollableContent.clientHeight;

            if (hasOverflow) {
                scrollableContent.addEventListener('scroll', handleScroll);
                handleScroll(); // Initial check
            } else {
                scrollableContent.removeEventListener('scroll', handleScroll);
                upButton.classList.remove('visible');
                downButton.classList.remove('visible');
                topFade.style.opacity = '0';
                bottomFade.style.opacity = '0';
            }
        };

        // Toggles the visibility of buttons and fades based on scroll position.
        const handleScroll = () => {
            const scrollTop = scrollableContent.scrollTop;
            const scrollHeight = scrollableContent.scrollHeight;
            const clientHeight = scrollableContent.clientHeight;

            const isAtTop = scrollTop === 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1; 

            upButton.classList.toggle('visible', !isAtTop);
            downButton.classList.toggle('visible', !isAtBottom);
            
            topFade.style.opacity = isAtTop ? '0' : '1';
            bottomFade.style.opacity = isAtBottom ? '0' : '1';
        };

        upButton.addEventListener('click', () => {
            scrollableContent.scrollBy({ top: -scrollableContent.clientHeight * 0.8, behavior: 'smooth' });
        });

        downButton.addEventListener('click', () => {
            scrollableContent.scrollBy({ top: scrollableContent.clientHeight * 0.8, behavior: 'smooth' });
        });

        // Re-check overflow on resize or content changes.
        const resizeObserver = new ResizeObserver(checkOverflow);
        resizeObserver.observe(scrollableContent);
        
        const mutationObserver = new MutationObserver(checkOverflow);
        mutationObserver.observe(scrollableContent, { childList: true, subtree: true });

        checkOverflow(); // Initial check
    });
}

/**
 * Parses a CSV string into an array of objects.
 * @param {string} csvText The raw CSV string.
 * @returns {Array<Object>} An array of objects, where each object represents a row.
 */
function parseCsv(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 1) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const dataRows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const rowObject = {};
        headers.forEach((header, index) => {
            rowObject[header] = values[index];
        });
        return rowObject;
    });
    return dataRows;
}

/**
 * Sets up the horizontal navigation controls (left/right buttons and indicator dots).
 */
function setupNavigation() {
    const container = document.querySelector('.scroll-container');
    const sections = Array.from(document.querySelectorAll('.scroll-section'));
    const indicatorContainer = document.querySelector('.indicator-container');
    const leftBtn = document.querySelector('.scroll-h-button.left');
    const rightBtn = document.querySelector('.scroll-h-button.right');

    if (!container || sections.length <= 1) {
        if(indicatorContainer) indicatorContainer.classList.add('hidden');
        return;
    }

    // Show controls if there are multiple sections.
    if(leftBtn) {
        leftBtn.classList.remove('hidden');
        leftBtn.classList.add('visible');
    }
    if(rightBtn) {
        rightBtn.classList.remove('hidden');
        rightBtn.classList.add('visible');
    }
    if(indicatorContainer) indicatorContainer.classList.remove('hidden');

    const scrollToSection = (index) => {
        const targetSection = sections[index];
        if (targetSection) {
            const scrollPosition = index * targetSection.offsetWidth;
            container.scrollTo({ left: scrollPosition, behavior: 'smooth' });
        }
    };

    // Create indicator dots from the template.
    const dotTemplate = document.getElementById('indicator-dot-template');
    indicatorContainer.innerHTML = '';
    sections.forEach((_, index) => {
        const dot = dotTemplate.content.cloneNode(true).firstElementChild;
        dot.setAttribute('aria-label', `Go to section ${index + 1}`);
        dot.addEventListener('click', () => scrollToSection(index));
        indicatorContainer.appendChild(dot);
    });

    const dots = indicatorContainer.querySelectorAll('.indicator-dot');

    // Use an IntersectionObserver to update the active dot and button states.
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const intersectingIndex = sections.indexOf(entry.target);
                
                dots.forEach((dot, dotIndex) => {
                    dot.classList.toggle('active', dotIndex === intersectingIndex);
                });

                leftBtn.disabled = intersectingIndex === 0;
                rightBtn.disabled = intersectingIndex === sections.length - 1;
            }
        });
    }, { root: container, threshold: 0.6 });

    sections.forEach(section => observer.observe(section));

    // Button click handlers.
    leftBtn.addEventListener('click', () => {
        const currentIndex = Math.round(container.scrollLeft / sections[0].offsetWidth);
        if (currentIndex > 0) scrollToSection(currentIndex - 1);
    });

    rightBtn.addEventListener('click', () => {
        const currentIndex = Math.round(container.scrollLeft / sections[0].offsetWidth);
        if (currentIndex < sections.length - 1) scrollToSection(currentIndex + 1);
    });
}

/**
 * Sets up the RSVP form by adding click listeners to the confirmation buttons
 * to populate hidden fields, show a spinner, and reload the page after submission.
 * @param {Object} guestInfo The guest's data object from the spreadsheet.
 * @param {string} code The short invitation code from the URL.
 */
function setupRsvpForm(guestInfo, code) {
    const form = document.getElementById('rsvp-form');
    if (!form) return;

    const codeInput = document.getElementById('rsvp-code-input');
    const confirmationInput = document.getElementById('rsvp-confirmation-input');
    const yesBtn = document.getElementById('rsvp-yes-btn');
    const noBtn = document.getElementById('rsvp-no-btn');
    const spinner = document.getElementById('loading-spinner');

    if (!codeInput || !confirmationInput || !yesBtn || !noBtn || !spinner) return;

    // The short invitation code from the URL is used to identify the guest in the Google Form.
    codeInput.value = code;

    const handleRsvpClick = (event) => {
        // Prevent the default form submission to handle it manually.
        event.preventDefault();

        // Set the confirmation value based on which button was clicked.
        confirmationInput.value = event.currentTarget.value;

        // Show the spinner.
        spinner.style.display = 'flex';
        setTimeout(() => {
            spinner.style.opacity = '1';
        }, 10); // Timeout allows the display property to apply before the transition starts.

        // Submit the form to the hidden iframe.
        form.submit();

        // Wait 10 seconds, then reload the page to show the updated status.
        setTimeout(() => {
            const url = new URL(window.location);
            url.searchParams.set('t', Date.now()); // Add cache-busting parameter
            window.location.href = url.href;
        }, 10000);
    };

    yesBtn.addEventListener('click', handleRsvpClick);
    noBtn.addEventListener('click', handleRsvpClick);
}

/**
 * Updates the text content of elements to handle singular/plural forms based on a count.
 * @param {string} type The data attribute prefix (e.g., 'guest', 'event').
 * @param {number} count The number to check for pluralization.
 */
function handlePlurals(type, count) {
    const elements = document.querySelectorAll(`[data-${type}-singular]`);
    if (!elements || elements.length === 0) return;

    elements.forEach(element => {
        const singularText = element.dataset[`${type}Singular`];
        const pluralText = element.dataset[`${type}Plural`];
        element.textContent = count === 1 ? singularText : pluralText;
    });
}

/**
 * Injects content from a <template> into the designated message section.
 * @param {string} templateId The ID of the template to use.
 */
function displayMessage(templateId) {
    const messageTemplate = document.getElementById(templateId);
    const errorSection = document.querySelector('[data-section="no-code"]');
    
    if (messageTemplate && errorSection) {
        const contentWrapper = errorSection.querySelector('.content-wrapper');
        const messageContent = messageTemplate.content.cloneNode(true);
        
        contentWrapper.innerHTML = ''; // Clear previous content
        contentWrapper.appendChild(messageContent);
        errorSection.classList.remove('hidden');

        // Also ensure the main portada is visible with the error.
        const portada = document.querySelector('[data-section="portada"]');
        if (portada) {
            portada.classList.remove('hidden');
        }
    }
}

/**
 * Safely decrypts a field, handling potential Base64 errors.
 * @param {string} data The encrypted data string.
 * @param {string} key The decryption key.
 * @returns {string|null} The decrypted string, or null if decryption fails.
 */
function decryptField(data, key) {
    if (typeof data !== 'string' || !data) {
        return null;
    }
    // Base64 strings shouldn't contain spaces, but URL encoding or copy-paste errors can introduce them.
    const sanitizedData = data.trim().replace(/ /g, '+');
    try {
        // The atob function will throw an error if the string is not a valid base64 string.
        return XXTEA.decryptFromBase64(sanitizedData, key);
    } catch (e) {
        // Log the error and the problematic data for debugging.
        console.error(`Failed to decrypt data. Input: "${data}", Sanitized: "${sanitizedData}"`, e);
        // Return a value that indicates failure but doesn't crash the app.
        return null; 
    }
}

/**
 * The core logic for processing guest data and building the dynamic sections of the invitation.
 * @param {string} code The invitation code from the URL.
 * @param {string} csvText The raw CSV string of guest data.
 * @param {string} eventCsvText The raw CSV string of event data.
 */
async function processGuestData(code, csvText, eventCsvText) {
    const longCard = document.querySelector('.long-card');
    const sectionTemplate = document.getElementById('scroll-section-template');

    /**
     * Creates a new section from a template and appends it to the page.
     * @param {string} id The data-section ID for the new section.
     * @param {string} templateId The ID of the template to use for the content.
     * @param {boolean} [isVcentered=false] Whether to vertically center the content.
     * @returns {HTMLElement} The newly created section element.
     */
    function createSection(id, templateId, isVcentered = false) {
        const section = sectionTemplate.content.cloneNode(true).firstElementChild;
        section.dataset.section = id;
        const contentWrapper = section.querySelector('.content-wrapper');
        if(isVcentered) contentWrapper.classList.add('v-center');
        
        const template = document.getElementById(templateId);
        if (template) {
            contentWrapper.appendChild(template.content.cloneNode(true));
        }

        longCard.appendChild(section);
        return section;
    }

    try {
        const guestData = parseCsv(csvText);
        let guestInfo = null;

        // Find the matching guest row by decrypting the code.
        if (code) {
            for (const guest of guestData) {
                const decryptedCode = decryptField(guest.Codigo, code);
                if (decryptedCode === code) {
                    guestInfo = { ...guest, Nombre: decryptField(guest.Nombre, code), Invitados: decryptField(guest.Invitados, code) };
                    break;
                }
            }
        }

        // Always create the cover page.
        createSection('portada', 'portada-template', true);

        if (guestInfo) {
            // Determine which sections to show based on guest data.
            const isInvitedToReception = guestInfo.Recepcion?.toLowerCase() === 'si';
            const sectionsToShow = {
                invitacion: true,
                civil: guestInfo.Civil?.toLowerCase() === 'si',
                'civil-recepcion': guestInfo.Civil?.toLowerCase() === 'si', // Add this line
                discurso: guestInfo.Discurso?.toLowerCase() === 'si',
                fiesta: isInvitedToReception,
                video: guestInfo.Video?.toLowerCase() === 'si',
                rsvp: isInvitedToReception,
                contratapa: true
            };

            if (sectionsToShow.invitacion) {
                createSection('invitacion', 'invitacion-template');
            }

            // Populate the dynamic fields in the invitation section.
            document.getElementById('group-name').textContent = `${guestInfo.Nombre}`;
            const decryptedInvitados = guestInfo.Invitados || '';
            const guestList = decryptedInvitados.split(',').map(name => name.trim()).filter(name => name);
            if (guestList.length > 0) {
                document.getElementById('guest-names').textContent = guestList.length === 1 ? guestList[0] : guestList.slice(0, -1).join(", ") + " y " + guestList.slice(-1);
            } else {
                const el = document.getElementById('guest-names');
                if(el) el.parentElement.classList.add('hidden');
            }
            const guestCount = parseInt(guestInfo.Cantidad, 10) || 0;
            if (guestCount > 0) document.getElementById('guest-count').textContent = guestCount;
            handlePlurals('guest', guestCount);

            // Show the RSVP section only if the guest is invited to the reception.
            if (sectionsToShow.rsvp) {
                const rsvpSection = document.querySelector('[data-section="invitacion"] [data-section="rsvp"]');
                if (rsvpSection) {
                    rsvpSection.classList.remove('hidden');
                }
            }

            // Handle RSVP status display.
            const rsvpStatus = guestInfo.Confirmado;
            if (rsvpStatus === 'Si') {
                document.getElementById('rsvp-form').classList.add('hidden');
                document.getElementById('rsvp-confirmed-message').classList.remove('hidden');
            } else if (rsvpStatus === 'No') {
                document.getElementById('rsvp-form').classList.add('hidden');
                document.getElementById('rsvp-declined-message').classList.remove('hidden');
            } else {
                // If the guest has not yet RSVP'd, set up the form.
                setupRsvpForm(guestInfo, code);
            }

            // Build the list of events the guest is invited to.
            const eventList = [];
            if (sectionsToShow.civil) eventList.push("ceremonia civil");
            if (sectionsToShow.discurso) eventList.push("discurso de bodas");
            if (sectionsToShow.fiesta) eventList.push("recepción de bodas");
            document.getElementById('event-list').textContent = eventList.length === 1 ? eventList[0] : eventList.slice(0, -1).join(", ") + " y " + eventList.slice(-1);
            handlePlurals('event', eventList.length);

            // Process and create the event-specific sections.
            const encryptedEventKey = guestInfo.Eventos;
            if (encryptedEventKey) {
                const eventKey = decryptField(encryptedEventKey, code);
                if (eventKey) {
                    await processEventDetails(eventKey, sectionsToShow, eventCsvText, createSection);
                }
            }
            
            // Create the back cover page.
            if (sectionsToShow.contratapa) {
                createSection('contratapa', 'contratapa-template', true);
            }

        } else {
            // If no valid guest code is found, display the "no code" message.
            const noCodeSection = createSection('no-code', '', true);
            const messageTemplate = document.getElementById('no-code-message');
            if(messageTemplate) noCodeSection.querySelector('.content-wrapper').appendChild(messageTemplate.content.cloneNode(true));
        }

    } catch (error) {
        console.error('Error processing guest data:', error);
        // If there's a data processing error, show the data error message.
        const errorSection = createSection('no-code', '', true);
        const messageTemplate = document.getElementById(error.message.includes('fetch') ? 'connection-error-message' : 'data-error-message');
        if(messageTemplate) errorSection.querySelector('.content-wrapper').appendChild(messageTemplate.content.cloneNode(true));
    } finally {
        // Hide the spinner and set up navigation once everything is done.
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            spinner.style.opacity = '0';
            setTimeout(() => { spinner.style.display = 'none'; }, 500);
        }
        setupNavigation();
    }
}

/**
 * Processes the event data and creates the corresponding sections.
 * @param {string} eventKey The decrypted key for the event data.
 * @param {Object} sectionsToShow An object indicating which sections are visible.
 * @param {string} csvText The raw CSV string of event data.
 * @param {Function} createSection The function to create a new section.
 */
async function processEventDetails(eventKey, sectionsToShow, csvText, createSection) {
    try {
        if (!csvText) throw new Error('Event data is not available.');
        const eventData = parseCsv(csvText);

        // Find the video URL first, as it's needed for the 'discurso' section.
        let videoUrl = '';
        for (const event of eventData) {
            if (decryptField(event.Evento, eventKey) === 'video') {
                videoUrl = decryptField(event.Direccion, eventKey);
                break;
            }
        }

        // Create sections for each event the guest is invited to.
        for (const event of eventData) {
            const eventName = decryptField(event.Evento, eventKey);
            if (!eventName || eventName === 'video') continue;

            // Special handling for civil-recepcion, which is inside the 'civil' section.
            if (eventName === 'civil-recepcion') {
                if (sectionsToShow[eventName]) {
                    const civilSection = document.querySelector('.scroll-section[data-section="civil"]');
                    const container = civilSection?.querySelector('[data-section="civil-recepcion"]');
                    if (container) {
                        populateEventSection(container, event, eventKey);
                    }
                }
                continue; // Move to the next event.
            }

            let sectionName = eventName;
            if (eventName === 'recepcion') sectionName = 'fiesta';

            if (sectionName && sectionsToShow[sectionName]) {
                const section = createSection(sectionName, `${sectionName}-template`);
                populateEventSection(section, event, eventKey);

                // Special handling for the 'discurso' section to include the video.
                if (sectionName === 'discurso') {
                    const videoSection = section.querySelector('[data-section="video"]');
                    if (videoUrl) {
                        const iframe = videoSection.querySelector('iframe');
                        iframe.src = videoUrl;
                    } else {
                        if (videoSection) videoSection.remove();
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error fetching event details:', error);
    }
}

/**
 * Populates the date, time, location, and map link for a given event section.
 * @param {HTMLElement} container The section element to populate.
 * @param {Object} event The event data object.
 * @param {string} eventKey The decryption key.
 */
function populateEventSection(container, event, eventKey) {
    const decryptedFechaStr = decryptField(event.Fecha, eventKey) || '';
    const lugar = decryptField(event.Lugar, eventKey);
    const direccion = decryptField(event.Direccion, eventKey);
    const mapa = decryptField(event.Mapa, eventKey);

    let fecha = '';
    let hora = '';

    if (decryptedFechaStr) {
        const dateObj = new Date(decryptedFechaStr);
        if (!isNaN(dateObj)) {
            fecha = dateObj.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            hora = dateObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
    }

    // Query within the provided container.
    container.querySelector('.fecha').textContent = fecha;
    container.querySelector('.hora').textContent = hora;
    container.querySelector('.lugar').textContent = lugar;
    container.querySelector('.direccion').textContent = direccion;
    const mapLink = container.querySelector('.mapa');
    if (mapa) {
        mapLink.href = mapa;
        mapLink.classList.remove('hidden');
    }
}
