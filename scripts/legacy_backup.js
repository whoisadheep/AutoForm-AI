function getQuestions() {
    let blocks = document.querySelectorAll('.Qr7Oae');
    let questions = [];

    blocks.forEach(block => {

        let qText = block.querySelector('.M7eMe')?.innerText.trim() || "(no question found)";

        let options = [...block.querySelectorAll('label')].map(label => {
            let span = label.querySelector("span.aDTYNe.snByac.kTYmRb.OIC90c");
            return span ? span.innerText.trim() : "(empty)";
        });

        questions.push({
            question: qText,
            options: options
        });
    });

    return questions;
}

setTimeout(() => {
    let qs = getQuestions();
    console.log("Extracted Questions:", qs);
}, 1500);
